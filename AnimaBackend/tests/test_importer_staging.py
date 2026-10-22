"""导入的第一步:先放进暂存目录(app/importer/staging.py),再按文件头认是什么(app/importer/sniff.py)。

暂存目录在 data/import-staging/<plan_id>/files/;zip 就地解开。安全上要挡住的(设计 6.4):
路径穿越和绝对路径、__MACOSX 这类垃圾、没 UTF-8 标记的中日文文件名、套娃 zip、解压炸弹。
"""

import io
import json
import os
import struct
import time
import unicodedata
import zipfile
import zlib
from pathlib import Path

import pytest

from app.config import settings
from app.importer import staging
from app.importer.sniff import kind_of
from app.importer.staging import StagingError, TooLarge, open_tree, stage
from tests.fixtures.cards.make_cards import b64, png

PNG = png()
CARD_PNG = png(("chara", b64({"spec": "chara_card_v2", "data": {"name": "刻晴"}})))
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(64))
CARD_JSON = json.dumps({"spec": "chara_card_v2", "data": {"name": "刻晴"}}, ensure_ascii=False).encode()


def _zip(*entries: tuple[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _zip_raw(*entries: tuple[bytes, bytes]) -> bytes:
    """文件名按原样字节写、不带 UTF-8 标记(老的 Windows / 日文压缩软件就是这样):
    先用同样长度的 ASCII 占位名写,再把占位名换成原始字节(本地头和中央目录各一处)"""
    holders = [f"{i:0{len(raw)}d}".encode() for i, (raw, _) in enumerate(entries)]
    assert all(len(h) == len(raw) for h, (raw, _) in zip(holders, entries))
    data = _zip(*((h.decode(), body) for h, (_, body) in zip(holders, entries)))
    for h, (raw, _) in zip(holders, entries):
        assert data.count(h) == 2
        data = data.replace(h, raw)
    return data


def _paths(tree) -> list[str]:
    return [f.path for f in tree.files]


def _kinds(tree) -> dict[str, str]:
    return {f.path: f.kind for f in tree.files}


def _left_behind(root: Path) -> list[Path]:
    return [p for p in root.rglob("*")] if root.exists() else []


# ── 普通文件 ──


def test_files_land_under_the_plan_dir_with_posix_paths_sizes_and_kinds(tmp_path: Path):
    tree = stage(
        [
            ("刻晴/立绘（玉衡星）/微笑.png", PNG),
            ("刻晴/BGM候选/a.mp3", MP3),
            ("刻晴.png", CARD_PNG),
            ("notes.txt", b"hello"),
        ],
        tmp_path,
    )
    assert len(tree.plan_id) == 32 and all(c in "0123456789abcdef" for c in tree.plan_id)
    assert tree.dir == tmp_path / tree.plan_id
    assert tree.root == tree.dir / "files"
    assert _paths(tree) == sorted(["刻晴/立绘（玉衡星）/微笑.png", "刻晴/BGM候选/a.mp3", "刻晴.png", "notes.txt"])
    assert _kinds(tree) == {
        "刻晴/立绘（玉衡星）/微笑.png": "image",
        "刻晴/BGM候选/a.mp3": "audio",
        "刻晴.png": "card_png",
        "notes.txt": "other",
    }
    sizes = {f.path: f.size for f in tree.files}
    assert sizes["刻晴/BGM候选/a.mp3"] == len(MP3)
    assert tree.path("刻晴/立绘（玉衡星）/微笑.png").read_bytes() == PNG


def test_content_can_be_bytes_a_path_or_a_file_object(tmp_path: Path):
    src = tmp_path / "src.mp3"
    src.write_bytes(MP3)
    tree = stage([("a.png", PNG), ("b.mp3", src), ("c.json", io.BytesIO(CARD_JSON))], tmp_path / "staging")
    assert _kinds(tree) == {"a.png": "image", "b.mp3": "audio", "c.json": "card_json"}
    assert src.exists()  # 传进来的文件不动


def test_names_are_nfc_and_backslashes_are_separators(tmp_path: Path):
    nfd = unicodedata.normalize("NFD", "ガ/パ.png")
    tree = stage([(nfd, PNG), ("立绘\\开心.png", PNG), ("./x//y.png", PNG)], tmp_path)
    assert _paths(tree) == sorted(["ガ/パ.png", "立绘/开心.png", "x/y.png"])


def test_windows_unsafe_names_are_made_safe(tmp_path: Path):
    tree = stage([("ab:c?.png", PNG), ("CON.png", PNG), ("dots. .", PNG), ("C:relative.png", PNG)], tmp_path)
    assert _paths(tree) == sorted(["ab_c_.png", "CON_.png", "dots", "C_relative.png"])


@pytest.mark.parametrize("bad", ["../evil.png", "a/../../evil.png", "/etc/passwd", "C:/Windows/evil.png", "C:\\evil.png", "\\\\server\\share\\x.png"])
def test_path_traversal_and_absolute_upload_paths_reject_the_batch(tmp_path: Path, bad: str):
    root = tmp_path / "staging"
    with pytest.raises(StagingError):
        stage([("ok.png", PNG), (bad, PNG)], root)
    assert _left_behind(root) == []
    assert not (tmp_path / "evil.png").exists()


def test_junk_files_are_skipped(tmp_path: Path):
    tree = stage(
        [
            ("pack/joy.png", PNG),
            ("pack/.DS_Store", b"junk"),
            ("pack/Thumbs.db", b"junk"),
            ("pack/desktop.ini", b"junk"),
            ("__MACOSX/pack/._joy.png", b"junk"),
        ],
        tmp_path,
    )
    assert _paths(tree) == ["pack/joy.png"]


# ── zip ──


def test_a_zip_is_unpacked_in_place_into_a_folder_named_after_it(tmp_path: Path):
    data = _zip(
        ("joy.png", PNG),
        ("sub/anger.png", JPEG),
        ("__MACOSX/._joy.png", b"junk"),
        (".DS_Store", b"junk"),
        ("sub/", b""),
    )
    tree = stage([("chars/pack.zip", data)], tmp_path)
    assert _paths(tree) == ["chars/pack/joy.png", "chars/pack/sub/anger.png"]
    assert not tree.path("chars/pack.zip").exists()


def test_a_single_top_folder_named_like_the_zip_is_not_doubled(tmp_path: Path):
    tree = stage([("刻晴.zip", _zip(("刻晴/立绘/微笑.png", PNG), ("刻晴/背景/庭院.png", PNG)))], tmp_path)
    assert _paths(tree) == ["刻晴/立绘/微笑.png", "刻晴/背景/庭院.png"]
    # Chub 的表情包:顶层一个角色名文件夹,和 zip 名不一样,照原样留着
    tree = stage([("expressions.zip", _zip(("Tae Takemi/joy.png", PNG), ("Tae Takemi/anger.png", PNG)))], tmp_path)
    assert _paths(tree) == ["expressions/Tae Takemi/anger.png", "expressions/Tae Takemi/joy.png"]


def test_names_without_the_utf8_flag_try_utf8_then_gbk_then_shift_jis(tmp_path: Path):
    gbk = _zip_raw(("立绘（玉衡星）/微笑.png".encode("gbk"), PNG), ("背景/庭院.png".encode("gbk"), PNG))
    # 「表」的 Shift-JIS 第二个字节是 0x5C(反斜杠):不能被当成路径分隔符
    sjis = _zip_raw(("表情/笑顔.png".encode("shift_jis"), PNG), ("ソフト.png".encode("shift_jis"), PNG))
    utf8 = _zip_raw(("开心.png".encode("utf-8"), PNG),)
    tree = stage([("gbk.zip", gbk), ("sjis.zip", sjis), ("utf8.zip", utf8)], tmp_path)
    assert _paths(tree) == sorted(
        ["gbk/立绘（玉衡星）/微笑.png", "gbk/背景/庭院.png", "sjis/表情/笑顔.png", "sjis/ソフト.png", "utf8/开心.png"]
    )


def test_zip_entries_that_escape_reject_the_whole_batch(tmp_path: Path):
    root = tmp_path / "staging"
    for bad in ("../../evil.png", "/abs/evil.png", "ok/../../evil.png", "C:/evil.png"):
        with pytest.raises(StagingError):
            stage([("a.png", PNG), ("x.zip", _zip(("fine.png", PNG), (bad, PNG)))], root)
        assert _left_behind(root) == []
    assert not any(p.name == "evil.png" for p in tmp_path.rglob("*"))


def test_nested_zips_are_unpacked_two_levels_deep(tmp_path: Path):
    deep = _zip(("x.png", PNG),)
    inner = _zip(("b.png", PNG), ("deep.zip", deep))
    outer = _zip(("a.png", PNG), ("inner.zip", inner))
    tree = stage([("outer.zip", outer)], tmp_path)
    assert _kinds(tree) == {
        "outer/a.png": "image",
        "outer/inner/b.png": "image",
        "outer/inner/deep.zip": "other",  # 第三层不解
    }


def test_pytorch_models_inside_a_zip_stay_whole(tmp_path: Path):
    # .ckpt / .pth 本身是 zip 格式;声音包里的模型要原样留着,不能被当成套着的压缩包解开
    model = _zip(("archive/data.pkl", b"x"),)
    outer = _zip(("assets/a.ckpt", model), ("assets/b.pth", model), ("assets/c.png", PNG))
    tree = stage([("pack.animavn", outer)], tmp_path)
    kinds = _kinds(tree)
    assert {k for k in kinds if k.endswith((".ckpt", ".pth"))} == {"pack/assets/a.ckpt", "pack/assets/b.pth"}
    assert not any("archive" in k for k in kinds)


def test_a_zip_hidden_after_a_jpeg_is_found(tmp_path: Path):
    """JPEG 后面接 zip(CHARX 有这种):往后找到 PK 头照样解开,外面那张图不留"""
    tree = stage([("card.jpg", JPEG + _zip(("card.json", CARD_JSON), ("assets/icon.png", PNG)))], tmp_path)
    assert _kinds(tree) == {"card/assets/icon.png": "image", "card/card.json": "card_json"}


def test_a_card_png_with_a_zip_appended_keeps_the_card(tmp_path: Path):
    tree = stage([("刻晴.png", CARD_PNG + _zip(("joy.png", PNG),))], tmp_path)
    assert _kinds(tree) == {"刻晴.png": "card_png", "刻晴/joy.png": "image"}


def test_names_that_clash_on_a_case_insensitive_disk_get_a_number(tmp_path: Path):
    tree = stage([("pack/Joy.png", PNG), ("pack/joy.png", JPEG), ("pack.zip", _zip(("a.png", PNG),))], tmp_path)
    assert _paths(tree) == ["pack 2/a.png", "pack/Joy.png", "pack/joy 2.png"]
    assert tree.path("pack/joy 2.png").read_bytes() == JPEG


def test_an_encrypted_zip_is_rejected(tmp_path: Path):
    data = bytearray(_zip(("a.png", PNG),))
    # 把通用标志位的「加密」位打开:本地头在第 6 字节,中央目录在第 8 字节
    local = data.index(b"PK\x03\x04")
    central = data.index(b"PK\x01\x02")
    data[local + 6] |= 1
    data[central + 8] |= 1
    with pytest.raises(StagingError, match="密码"):
        stage([("x.zip", bytes(data))], tmp_path)


def test_a_broken_zip_is_rejected(tmp_path: Path):
    data = bytearray(_zip(("a.png", PNG * 20),))
    start = data.index(b"PK\x03\x04") + 30 + len("a.png")
    data[start : start + 8] = b"\xff" * 8  # 压缩数据坏了
    with pytest.raises(StagingError):
        stage([("x.zip", bytes(data))], tmp_path)


# ── 上限 ──


def test_too_many_files_rejects_the_whole_batch(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(staging, "MAX_FILES", 3)
    root = tmp_path / "staging"
    with pytest.raises(TooLarge):
        stage([(f"{i}.png", PNG) for i in range(4)], root)
    assert _left_behind(root) == []
    with pytest.raises(TooLarge):
        stage([("a.png", PNG), ("x.zip", _zip(*((f"{i}.png", PNG) for i in range(3))))], root)
    assert _left_behind(root) == []
    # 正好 3 个可以(解开的 zip 本身不算)
    assert len(stage([("x.zip", _zip(*((f"{i}.png", PNG) for i in range(3))))], root).files) == 3


def test_too_many_bytes_rejects_the_whole_batch_before_unpacking(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(staging, "MAX_TOTAL_BYTES", 10_000)
    root = tmp_path / "staging"
    bomb = _zip(("zeros.bin", b"\x00" * 1_000_000))  # 压缩后很小,解开 1 MB
    assert len(bomb) < 10_000
    with pytest.raises(TooLarge):
        stage([("bomb.zip", bomb)], root)
    assert _left_behind(root) == []
    with pytest.raises(TooLarge):
        stage([("a.bin", b"\x00" * 6000), ("b.bin", b"\x00" * 6000)], root)
    assert _left_behind(root) == []


# ── 暂存目录 ──


def test_staging_root_sits_next_to_the_database(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "import_staging_dir", None)
    db = tmp_path / "data" / "animabackend.db"
    assert staging.staging_root(f"sqlite:///{db.as_posix()}") == tmp_path / "data" / "import-staging"
    assert staging.staging_root("sqlite://").name == "import-staging"
    monkeypatch.setattr(settings, "import_staging_dir", str(tmp_path / "elsewhere"))
    assert staging.staging_root(f"sqlite:///{db.as_posix()}") == tmp_path / "elsewhere"


def test_stage_defaults_to_the_configured_root(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "import_staging_dir", str(tmp_path / "configured"))
    tree = stage([("a.png", PNG)])
    assert tree.dir.parent == tmp_path / "configured"


def test_open_tree_reads_a_staged_plan_back(tmp_path: Path):
    tree = stage([("pack.zip", _zip(("joy.png", PNG), ("anger.png", JPEG))), ("刻晴.png", CARD_PNG)], tmp_path)
    again = open_tree(tree.plan_id, tmp_path)
    assert again == tree
    for bad in ("../x", "nothere", "0" * 32):
        with pytest.raises(StagingError):
            open_tree(bad, tmp_path)


def test_discard_and_purge(tmp_path: Path):
    old = stage([("a.png", PNG)], tmp_path)
    new = stage([("b.png", PNG)], tmp_path)
    week = time.time() - 8 * 24 * 3600
    os.utime(old.dir, (week, week))
    assert staging.purge(tmp_path, max_age_days=7) == 1
    assert not old.dir.exists() and new.dir.exists()
    staging.discard(new.plan_id, tmp_path)
    assert not new.dir.exists()
    staging.discard(new.plan_id, tmp_path)  # 再删一次不报错
    assert staging.purge(tmp_path / "missing") == 0


# ── 认文件(按文件头,不看扩展名) ──


def _kind(tmp_path: Path, name: str, data: bytes) -> str:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return kind_of(path)


def _ftyp(brand: bytes) -> bytes:
    return struct.pack(">I", 24) + b"ftyp" + brand + b"\x00\x00\x00\x00" + brand + b"mp41"


@pytest.mark.parametrize(
    ("name", "data", "kind"),
    [
        ("card.png", CARD_PNG, "card_png"),
        ("v3.png", png(("ccv3", b64({"spec": "chara_card_v3", "data": {"name": "x"}}))), "card_png"),
        ("empty-chara.png", png(("chara", "")), "image"),
        ("plain.png", PNG, "image"),
        ("photo.png", JPEG, "image"),  # 扩展名不对也按内容认
        ("anim.gif", b"GIF89a" + b"\x00" * 20, "image"),
        ("a.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 20, "image"),
        ("error-page.png", b"<!DOCTYPE html><html><body>404</body></html>", "other"),
        ("song.mp3", MP3, "audio"),
        ("song.ogg", b"OggS" + b"\x00" * 40, "audio"),
        ("voice.wav", b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 20, "audio"),
        ("song.flac", b"fLaC" + b"\x00" * 40, "audio"),
        ("song.m4a", _ftyp(b"M4A "), "audio"),
        ("pic.avif", _ftyp(b"avif"), "other"),
        ("pic.heic", _ftyp(b"heic"), "other"),
        ("empty.bin", b"", "other"),
        ("notes.txt", "随便写点什么".encode(), "other"),
        ("pack.zip", _zip(("a.png", PNG),), "other"),
    ],
)
def test_kind_of_binary_files(tmp_path: Path, name: str, data: bytes, kind: str):
    assert _kind(tmp_path, name, data) == kind


def _j(value) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


@pytest.mark.parametrize(
    ("name", "data", "kind"),
    [
        ("v2.json", _j({"spec": "chara_card_v2", "data": {}}), "card_json"),
        ("v3.json", _j({"spec": "chara_card_v3", "spec_version": "3.0", "data": {"name": "x"}}), "card_json"),
        ("v1.json", _j({"name": "Seraphina", "first_mes": "hi"}), "card_json"),
        ("v1b.json", _j({"name": "Seraphina", "description": "guardian"}), "card_json"),
        ("bom.json", b"\xef\xbb\xbf" + _j({"spec": "chara_card_v2"}), "card_json"),
        ("card.txt", _j({"spec": "chara_card_v2"}), "card_json"),  # 扩展名不对也认
        ("name-only.json", _j({"name": "x"}), "other"),
        ("import.json", _j([{"name": "膝枕", "file": "C:\\x\\默认.jpg", "variants": []}, {"name": "拥抱", "file": "b.jpg"}]), "cg_manifest"),
        ("list.json", _j([{"name": "膝枕"}]), "other"),
        ("empty-list.json", _j([]), "other"),
        ("picks.json", _j({"封面": ["原神.m4a"], "心动": ["小小的光.m4a", "无虑无猜的岁月.m4a"]}), "bgm_picks"),
        ("PICKS.JSON", _j({"日常": ["a.mp3"]}), "bgm_picks"),
        ("other.json", _j({"封面": ["原神.m4a"]}), "other"),  # 不叫 picks.json
        ("语音参考/picks.json", _j({"ja:微笑": {"no": 1, "local": "a.wav"}}), "other"),  # 语音挑选的 picks.json 不是曲子
        ("refs.json", _j({"character": "刻晴", "refs": [{"emotion": "微笑", "path": "a.wav", "text": "嗯"}]}), "voice_refs"),
        ("broken.json", b'{"spec": "chara_card_v2"', "other"),
        ("nan.json", b'{"name": "x", "first_mes": NaN}', "other"),
    ],
)
def test_kind_of_json_files(tmp_path: Path, name: str, data: bytes, kind: str):
    assert _kind(tmp_path, name, data) == kind


def test_kind_of_finds_a_card_chunk_after_a_big_image_chunk(tmp_path: Path):
    """酒馆把 chara 块写在 IDAT 后面:认卡时要走到文件末尾(按块长度跳过,不读图像数据)"""
    big = png()
    idat = struct.pack(">I", 200_000) + b"IDAT" + b"\x00" * 200_000
    idat += struct.pack(">I", zlib.crc32(b"IDAT" + b"\x00" * 200_000) & 0xFFFFFFFF)
    text = b"chara\x00" + b64({"name": "x", "first_mes": "y"}).encode()
    tail = struct.pack(">I", len(text)) + b"tEXt" + text + struct.pack(">I", zlib.crc32(b"tEXt" + text) & 0xFFFFFFFF)
    iend = big[-12:]
    data = big[:-12] + idat + tail + iend
    assert _kind(tmp_path, "late.png", data) == "card_png"
