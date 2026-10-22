"""规范形:把一组卡(或一个包)写成「不带编号、名字去掉导入时接的「 2」」的样子,用来比较导出前和导回来的东西
(往返测试 tests/test_bundle_restore.py、往返验收 scripts/bundle_roundtrip.py)。只读库。

范围和导出一样(collect.py):整组状态卡;立绘包、场景包、CG 包的绑定(声音不算);已经拆成 CG 包的场景包里的 CG 不算;
背景的默认曲指着范围外的曲子算 null;按卡设置只看 plugin.*;配对表只看 CG 的;一套立绘都没有时看内置名单的认词记录。
编号一律换成「包名 / 种类 / 构图名 / 名字」,文件换成指纹(库里没记指纹的按原件现算)。卡的 spec 不比:导出写成 CCv3。
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import bindings, cg_sync, states
from app.bundle.collect import (
    BUILTIN,
    CARD_FIELDS,
    IMAGEGEN_KEY,
    PACK_PREFIX,
    PLUGIN_PREFIX,
    PRESET_FIELDS,
    _preset_of,
    parse_data_url,
)
from app.models import (
    AppSetting,
    CardPref,
    CardRole,
    CgAsset,
    CgPack,
    PackSprite,
    Pairing,
    PairingRow,
    SceneAsset,
    ScenePack,
    SpritePack,
    SpritePackLayout,
    TavernCard,
    WordRecord,
)
from app.storage import refs
from app.storage.blobs import sha_of

_SUFFIX = re.compile(r" \d+$")
_SKIP = {"id", "pack_id", "created_at", "updated_at", "source_scene_pack_id"}
MODELS = {
    "sprite": (SpritePack, PackSprite, refs.SPRITE),
    "scene": (ScenePack, SceneAsset, refs.SCENE_ASSET),
    "cg": (CgPack, CgAsset, refs.CG_ASSET),
}


def strip(name: str | None) -> str:
    return _SUFFIX.sub("", name or "")


def _sorted(rows: Iterable) -> list:
    return sorted(rows, key=lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True, default=str))


class _Packs:
    """范围里的包:先记下每一行叫什么(编号 → 名字),再写规范形"""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.rows: dict[tuple[str, str], list] = {}  # (种类, 包编号) → 行
        self.name: dict[str, str] = {}  # 包编号 → 去掉后缀的名字
        self.ref: dict[str, str] = {}  # 行编号 → 「包名/种类/构图/名字」

    def add(self, kind: str, pack_id: str) -> None:
        pack_model, row_model, _ = MODELS[kind]
        pack = self.db.get(pack_model, pack_id)
        rows = list(self.db.scalars(select(row_model).where(row_model.pack_id == pack_id)).all())
        if kind == "scene" and cg_sync.cg_pack_of_scene(self.db, pack_id) is not None:
            rows = [r for r in rows if r.kind != "cg"]
        self.rows[(kind, pack_id)] = rows
        self.name[pack_id] = strip(pack.name)
        labels = {r.id: r.label for r in rows}
        for r in rows:
            sub = getattr(r, "kind", kind)
            parent = labels.get(getattr(r, "parent_id", None) or "", "")
            self.ref[r.id] = f"{self.name[pack_id]}/{sub}/{parent}/{r.label}"

    def canon(self, kind: str, pack_id: str) -> dict:
        db = self.db
        pack_model, row_model, ref = MODELS[kind]
        pack = db.get(pack_model, pack_id)
        rows = self.rows[(kind, pack_id)]
        own = {r.id for r in rows}
        head = {c.key: copy.deepcopy(getattr(pack, c.key)) for c in pack.__table__.columns if c.key not in _SKIP}
        head["name"] = strip(head["name"])
        if "title_bgm_id" in head:
            head["title_bgm_id"] = self.ref.get(head["title_bgm_id"]) if head["title_bgm_id"] in own else None
        items = []
        for r in rows:
            item = {}
            for c in r.__table__.columns:
                if c.key in _SKIP or c.key == ref.data:
                    continue
                item[c.key] = copy.deepcopy(getattr(r, c.key))
            if item.get(ref.sha) is None and ref.mime_of(r) is not None:
                data = refs.read_bytes(ref, r, db)
                item[ref.sha] = sha_of(data) if data is not None else None
            if "bgm_id" in item:
                item["bgm_id"] = self.ref.get(item["bgm_id"]) if item["bgm_id"] else None
            if "parent_id" in item:
                item["parent_id"] = self.ref.get(item["parent_id"]) if item["parent_id"] in own else None
            items.append(item)
        out = {"kind": kind, "pack": head, "items": _sorted(items)}
        if kind == "sprite":
            layout = db.get(SpritePackLayout, pack_id)
            out["layouts"] = [{k: getattr(layout, k) for k in ("auto", "zoom", "dx", "dy")}] if layout else []
        return out

    def word_records(self, pack_id: str) -> list:
        rows = self.db.scalars(select(WordRecord).where(WordRecord.list_ref == PACK_PREFIX + pack_id)).all()
        return _sorted(
            [self.name[pack_id], w.word, self.ref[w.item], w.source, w.guessed, w.unstable, w.score]
            for w in rows
            if w.item in self.ref
        )


def pack_canonical(db: Session, kind: str, pack_id: str) -> dict:
    """单包的规范形(立绘包连同认词记录)"""
    p = _Packs(db)
    p.add(kind, pack_id)
    out = p.canon(kind, pack_id)
    if kind == "sprite":
        out["word_records"] = p.word_records(pack_id)
    return out


def _group(db: Session, card_id: str) -> tuple[list[str], str]:
    g = states.group_of(db, card_id)
    if g["group_id"] is None:
        return [card_id], card_id
    return [s["card_id"] for s in g["states"] if db.get(TavernCard, s["card_id"]) is not None], g["main_card_id"]


def canonical(db: Session, card_id: str, exclude: Iterable[str] = ()) -> dict:
    """这张卡所在的整组(主卡从哪张进来都一样)的规范形。exclude 同导出:"sprite:<id>" 这样的"""
    excluded = set(exclude)
    cards, main = _group(db, card_id)
    idx = {c: i for i, c in enumerate(cards)}
    p = _Packs(db)
    models = {"sprite": SpritePack, "scene": ScenePack, "cg": CgPack}

    def ok(kind: str, target: str) -> bool:
        return f"{kind}:{target}" not in excluded and db.get(models[kind], target) is not None

    per_card = {}
    for c in cards:
        sprite = [(t, pr) for t, pr in bindings.bound(db, c, bindings.SPRITE) if ok("sprite", t)]
        parts = bindings.scene_parts(db, c)
        cg = [t for t in bindings.targets(db, c, bindings.CG) if ok("cg", t)]
        per_card[c] = (sprite, [t for t in parts["bg"] if ok("scene", t)], [t for t in parts["bgm"] if ok("scene", t)], cg)
        for t, _ in sprite:
            if ("sprite", t) not in p.rows:
                p.add("sprite", t)
        for t in per_card[c][1] + per_card[c][2]:
            if ("scene", t) not in p.rows:
                p.add("scene", t)
        for t in cg:
            if ("cg", t) not in p.rows:
                p.add("cg", t)

    out: dict = {}
    card_out = []
    for c in cards:
        card = db.get(TavernCard, c)
        fields = {f: copy.deepcopy(getattr(card, f)) for f in CARD_FIELDS}
        fields["name"] = strip(fields["name"])
        fields["extensions"] = {k: v for k, v in (fields["extensions"] or {}).items() if k != "animavn"}
        avatar = parse_data_url(card.avatar)
        fields["avatar"] = sha_of(avatar[0]) if avatar else None
        roles = db.scalars(select(CardRole).where(CardRole.card_id == c)).all()
        sprite, bg, bgm, cg = per_card[c]
        card_out.append(
            {
                "card": fields,
                "roles": _sorted([r.name, r.aliases, r.sort, r.is_main] for r in roles),
                "sprite": [[p.name[t], pr] for t, pr in sprite],
                "bg": [p.name[t] for t in bg],
                "bgm": [p.name[t] for t in bgm],
                "cg": [p.name[t] for t in cg],
            }
        )
    out["cards"] = card_out
    out["main"] = idx.get(main)
    g = states.group_of(db, card_id)
    out["states"] = [[idx[s["card_id"]], s["name"], s["sort"], s["show_in_pick"]] for s in g["states"] if s["card_id"] in idx]
    out["packs"] = _sorted(p.canon(kind, pid) for kind, pid in p.rows)

    sprite_ids = [pid for kind, pid in p.rows if kind == "sprite"]
    words = [w for pid in sprite_ids for w in p.word_records(pid)]
    if not sprite_ids:
        words = _sorted(
            [BUILTIN, w.word, w.item, w.source, w.guessed, w.unstable, w.score]
            for w in db.scalars(select(WordRecord).where(WordRecord.list_ref == BUILTIN)).all()
        )
    out["word_records"] = _sorted(words)

    comps = {r.id for (kind, _), rows in p.rows.items() for r in rows if kind in ("cg", "scene") and getattr(r, "kind", "cg") == "cg" and r.parent_id is None}
    pairings = []
    lists = {PACK_PREFIX + pid: pid for pid in sprite_ids}
    if lists and comps:
        for pr in db.scalars(
            select(Pairing).where(Pairing.follower == "cg", Pairing.list_ref.in_(list(lists)), Pairing.target.in_(list(comps)))
        ).all():
            if pr.card_id and pr.card_id not in idx:
                continue
            own = {r.id for r in p.rows[("sprite", lists[pr.list_ref])]}
            cells = db.scalars(select(PairingRow).where(PairingRow.pairing_id == pr.id)).all()
            pairings.append(
                [
                    p.name[lists[pr.list_ref]],
                    p.ref[pr.target],
                    idx.get(pr.card_id) if pr.card_id else None,
                    _sorted(
                        [p.ref[r.item], p.ref.get(r.value) if r.value else None, r.source, r.guessed, r.pending, r.unstable]
                        for r in cells
                        if r.item in own
                    ),
                ]
            )
    out["pairings"] = _sorted(pairings)

    sprite_items = {r.id for (kind, _), rows in p.rows.items() if kind == "sprite" for r in rows}
    prefs = []
    for pref in db.scalars(select(CardPref).where(CardPref.card_id.in_(cards))).all():
        if not pref.key.startswith(PLUGIN_PREFIX):
            continue
        value = copy.deepcopy(pref.value)
        if pref.key == IMAGEGEN_KEY and isinstance(value, dict) and isinstance(value.get("ref"), dict):
            ref_id = value["ref"].get("id")
            if ref_id is not None:
                if ref_id in sprite_items:
                    value["ref"]["id"] = p.ref[ref_id]
                else:
                    value.pop("ref")
        prefs.append([idx[pref.card_id], pref.key, value])
    out["card_prefs"] = _sorted(prefs)

    preset = _preset_of(db, main)
    if preset is not None:
        row = db.get(AppSetting, "preset.bindings")
        bound = (row.value or {}).get("cards", {}) if row is not None and isinstance(row.value, dict) else {}
        body = {f: copy.deepcopy(getattr(preset, f)) for f in PRESET_FIELDS}
        body["name"] = strip(body["name"])
        out["preset"] = {"body": body, "cards": sorted(idx[c] for c in cards if bound.get(c) == preset.id)}
    else:
        out["preset"] = None
    return out
