"""打 Windows 整合包:Python 便携版 + 依赖 + 后端 + 打包好的页面 + 情绪模型,解压双击就能玩。

    <装好依赖、跑过测试的 venv 里的 python> packaging/windows/build.py [--src 目录] [--version 2026.10.17]

--src 是要打包的那份代码(默认这个仓库)。前端要先 npm install 过(要用它的 vite)。
出来的东西在 --out(默认 packaging/windows/out):
  AnimaVN-<版本>-windows.zip  整合包
  AnimaVN-<版本>-update.zip   更新包:只有代码和页面,「更新.bat」下的就是它
  latest.json                 更新器看的:最新版本号、运行环境指纹、两个包的大小和校验值
  stage/AnimaVN/              解压后的样子,可以直接双击里面的 AnimaVN.bat 试

依赖的版本记在 requirements.lock,换版本是有意的:--refresh-lock 按这个 venv 里装着的版本重新生成。
lock 一变,运行环境指纹就变,玩家那边「更新.bat」会让他们重下整合包 —— 所以别顺手改。
"""

import argparse
import datetime
import hashlib
import importlib.metadata as md
import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import time
import tomllib
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCK_FILE = HERE / "requirements.lock"
SOURCES_FILE = HERE / "sources.json"
PAYLOAD = HERE / "payload"

# 官方便携版 Python。3.11.9 是 3.11 最后一个带 Windows 安装包的版本,和开发用的 venv 一致
PY_VERSION = "3.11.9"
PY_EMBED_URL = f"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"
PY_EMBED_SHA256 = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b"
# 便携版只带了 vcruntime140*.dll;onnxruntime、greenlet 还要这两个,没装 VC++ 运行库的电脑上没有
VC_DLLS = ["msvcp140.dll", "msvcp140_1.dll"]
EMOTION_MODEL = "bge-small-zh-v1.5"
# 纯 Python 的包挪进 python/site-packages.zip(zip_pure_packages);这些后缀算说明文件,不挡
DOC_SUFFIXES = (".md", ".txt", ".rst")
DOC_NAMES = ("py.typed", ".keep")  # openai、anthropic 都带一个空的 lib/.keep
# 虽然是纯 Python,但会按 __file__ 去找自己目录里的文件:留在文件夹里
KEEP_ON_DISK = ("huggingface_hub",)

sys.path.insert(0, str(PAYLOAD / "launcher"))
from common import RUNTIME_ZIP  # noqa: E402
from update import UPDATE_ITEMS  # noqa: E402  更新包里放什么,和更新器用同一张单子

# 放进里面那层 runtime.zip 的:文件多的都在这(外层只剩 Python 本体、启动器、bat 和说明)
RUNTIME_ITEMS = ["python/Lib/site-packages", "AnimaBackend/app", "AnimaBackend/models", "web"]


def step(msg: str) -> None:
    print(f"\n== {msg}", flush=True)


def size_of(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def mb(n: int) -> str:
    return f"{n / 1048576:.1f} MB"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def installed(site: Path) -> dict[str, str]:
    return {norm(d.metadata["Name"]): d.version for d in md.distributions(path=[str(site)])}


def pip_install(site: Path, *args: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--no-compile",
         "--only-binary=:all:", "--platform", "win_amd64", "--python-version", PY_VERSION.rsplit(".", 1)[0],
         "--implementation", "cp", "--target", str(site), *args],
        check=True,
    )


def python_embed(cache: Path, dest: Path) -> None:
    zip_path = cache / f"python-{PY_VERSION}-embed-amd64.zip"
    if not zip_path.is_file() or sha256(zip_path) != PY_EMBED_SHA256:
        print(f"下载 {PY_EMBED_URL}")
        urllib.request.urlretrieve(PY_EMBED_URL, zip_path)
        if sha256(zip_path) != PY_EMBED_SHA256:
            raise SystemExit("便携版 Python 的校验值对不上")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest)
    # 便携版默认只认自己的标准库:把依赖、后端、启动器所在的文件夹写进来,再打开 site
    tag = "".join(PY_VERSION.split(".")[:2])
    (dest / f"python{tag}._pth").write_text(
        f"python{tag}.zip\n.\nsite-packages.zip\nLib\\site-packages\n..\\AnimaBackend\n..\nimport site\n",
        encoding="ascii",
    )


def dependencies(src: Path, site: Path, refresh: bool, out: Path) -> None:
    deps = tomllib.loads((src / "AnimaBackend" / "pyproject.toml").read_text("utf-8"))["project"]["dependencies"]
    venv = {norm(d.metadata["Name"]): d.version for d in md.distributions()}
    if refresh or not LOCK_FILE.exists():
        # 按这个 venv(跑过测试的那个)里的版本装,装上什么就记成 lock
        cons = out / "constraints.txt"
        cons.write_text("\n".join(f"{n}=={v}" for n, v in sorted(venv.items())), encoding="utf-8")
        pip_install(site, "-c", str(cons), *deps)
        got = installed(site)
        LOCK_FILE.write_text(
            "# 整合包里的依赖版本(packaging/windows/build.py --refresh-lock 生成)。改了它玩家就要重下整合包\n"
            + "".join(f"{n}=={v}\n" for n, v in sorted(got.items())),
            encoding="utf-8",
        )
        print(f"requirements.lock 重新生成了:{len(got)} 个包")
    else:
        pip_install(site, "--no-deps", "-r", str(LOCK_FILE))
    got = installed(site)
    names = [norm(re.split(r"[\s\[<>=!~;]", d, maxsplit=1)[0]) for d in deps]
    missing = [n for n in names if n not in got]
    if missing:
        raise SystemExit(f"pyproject 里的 {', '.join(missing)} 不在 requirements.lock 里:加 --refresh-lock 重打")
    differ = [f"{n} 包里 {v} / venv {venv[n]}" for n, v in sorted(got.items()) if n in venv and venv[n] != v]
    if differ:
        print("注意:整合包里的版本和这个 venv 不一样(测试跑的是 venv 的):\n  " + "\n  ".join(differ))
    shutil.rmtree(site / "bin", ignore_errors=True)  # pip 生成的 uvicorn.exe 之类,指着打包机的 Python,用不了
    for tests in [p for p in site.glob("*/**/tests") if p.is_dir()]:  # numpy 一家就有 700 多个测试文件
        shutil.rmtree(tests, ignore_errors=True)


def zip_pure_packages(site: Path, dest: Path) -> list[str]:
    """纯 Python 的包连同编译好的 .pyc 挪进一个 zip,Python 直接从 zip 里导入(标准库也是这么放的)。

    第一次启动不用再编译、杀毒软件也不用一个个扫:openai、anthropic 两家就四千多个文件,
    散着放第一次启动光导入它俩就要将近一分钟。带 .pyd / .dll 的包、带数据文件的包留在文件夹里;
    .dist-info 也留着(importlib.metadata 在文件夹里找版本号和插件)。
    """
    pure = []
    for p in sorted(site.iterdir()):
        if p.name.endswith((".dist-info", ".libs", ".pth")) or p.name in ("__pycache__", *KEEP_ON_DISK):
            continue
        if p.is_file():
            if p.suffix == ".py":
                pure.append(p)
            continue
        files = [f for f in p.rglob("*") if f.is_file() and "__pycache__" not in f.parts]
        if all(f.suffix in (".py", ".pyi", *DOC_SUFFIXES) or f.name in DOC_NAMES for f in files):
            pure.append(p)
    tmp = dest.with_suffix(".pyc.tmp")
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for p in pure:
            # 文件夹也要单独记一条:没有 __init__.py 的子目录(anthropic._decoders)zip 里只认这个
            for d in sorted(x for x in [p, *p.rglob("*")] if x.is_dir() and x.name != "__pycache__"):
                z.writestr(d.relative_to(site).as_posix() + "/", "")
            for f in sorted(p.rglob("*.py")) if p.is_dir() else [p]:
                rel = f.relative_to(site).as_posix()
                z.write(f, rel)  # 源码留着,出错时报错信息里能看到是哪一行
                # 不校验的 .pyc 放在 .py 旁边(zip 里不认 __pycache__):zip 只会整个换,不会和源码对不上
                py_compile.compile(str(f), cfile=str(tmp), dfile=rel, doraise=True,
                                   invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
                z.write(tmp, rel + "c")
    tmp.unlink()
    for p in pure:
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    return [p.name for p in pure]


def emotion_model(src: Path, cache: Path, dest: Path) -> None:
    model = cache / "models" / EMOTION_MODEL
    subprocess.run(
        [sys.executable, str(src / "AnimaBackend" / "scripts" / "download_emotion_model.py"), "--dir", str(model)],
        check=True,
    )
    shutil.copytree(model, dest / EMOTION_MODEL)


def web(src: Path, dest: Path) -> None:
    if not (src / "frontend" / "node_modules").is_dir():
        raise SystemExit(f"{src / 'frontend'} 里还没 npm install")
    env = dict(os.environ, VITE_API_BASE_URL="")  # 空 = 同源:页面和接口在同一个端口
    env.pop("VITE_ENV_LABEL", None)
    subprocess.run(
        f'npx vite build --logLevel error --outDir "{dest}" --emptyOutDir',
        cwd=src / "frontend", env=env, shell=True, check=True,
    )


def runtime_fingerprint(site: Path, models: Path) -> str:
    """Python、依赖、情绪模型合起来的指纹。只有它变了,玩家才需要重下整合包。"""
    h = hashlib.sha256(f"python {PY_VERSION}\n".encode())
    for n, v in sorted(installed(site).items()):
        h.update(f"{n}=={v}\n".encode())
    for f in sorted(models.rglob("*")):
        if f.is_file():
            h.update(f"{f.relative_to(models).as_posix()} {sha256(f)}\n".encode())
    return h.hexdigest()[:16]


def files_of(stage: Path, items: list[str]) -> list[Path]:
    files = []
    for item in items:
        p = stage / item
        files += [p] if p.is_file() else sorted(f for f in p.rglob("*") if f.is_file())
    return files


def write_zip(out: Path, stage: Path, files: list[Path], prefix: str = "", extra: Path | None = None) -> dict:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, Path(prefix) / f.relative_to(stage))
        if extra:  # 里面那层已经压过了,外层原样放
            z.write(extra, Path(prefix) / extra.name, compress_type=zipfile.ZIP_STORED)
    return {"file": out.name, "size": out.stat().st_size, "sha256": sha256(out)}


def main() -> None:
    today = datetime.date.today()
    ap = argparse.ArgumentParser(description="打 Windows 整合包")
    ap.add_argument("--src", type=Path, default=HERE.parents[1], help="要打包的代码(仓库根目录)")
    ap.add_argument("--out", type=Path, default=HERE / "out")
    ap.add_argument("--version", default=f"{today.year}.{today.month}.{today.day}")
    ap.add_argument("--sources", type=Path, default=SOURCES_FILE, help="更新器去哪找新版")
    ap.add_argument("--cache", type=Path, default=Path(os.environ.get("LOCALAPPDATA", HERE / "out")) / "AnimaVN-build")
    ap.add_argument("--refresh-lock", action="store_true", help="按这个 venv 里的版本重新生成 requirements.lock")
    args = ap.parse_args()

    if sys.platform != "win32" or sys.version_info[:2] != tuple(map(int, PY_VERSION.split(".")[:2])):
        raise SystemExit(f"要在 Windows 上、用 Python {PY_VERSION.rsplit('.', 1)[0]} 的 venv 跑")
    src = args.src.resolve()
    tag = ""
    if (src / "publish" / "make_public.py").exists():
        tag = "-PRIVATE-TEST"
        print("!! 这是私有仓库:打出来的包带着私有卡带,只能自己测,别发出去。正式版从公开版目录打(--src)")

    t0 = time.time()
    out = args.out.resolve()
    stage = out / "stage" / "AnimaVN"
    shutil.rmtree(stage.parent, ignore_errors=True)
    stage.mkdir(parents=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    py = stage / "python"
    site = py / "Lib" / "site-packages"

    step(f"Python {PY_VERSION} 便携版")
    python_embed(args.cache, py)
    for dll in VC_DLLS:
        shutil.copy2(Path(os.environ["SystemRoot"]) / "System32" / dll, py / dll)

    step("依赖")
    dependencies(src, site, args.refresh_lock, out)
    print(f"{len(installed(site))} 个包,{mb(size_of(site))}")
    zipped = zip_pure_packages(site, py / "site-packages.zip")
    print(f"纯 Python 的 {len(zipped)} 个放进了 site-packages.zip({mb((py / 'site-packages.zip').stat().st_size)}):")
    print("  " + " ".join(zipped))

    step("后端 + 情绪模型")
    shutil.copytree(src / "AnimaBackend" / "app", stage / "AnimaBackend" / "app",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    emotion_model(src, args.cache, stage / "AnimaBackend" / "models")

    step("游戏页面(打包好的,玩家不用装 Node)")
    web(src, stage / "web")

    step("启动器、更新器、说明")
    shutil.copytree(PAYLOAD, stage, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
    # 不管仓库按什么换行符检出:bat 用 CRLF(cmd 遇到 LF 偶尔会错行),说明带 BOM(老记事本才认得出 UTF-8)
    for f in [*stage.glob("*.bat"), *stage.glob("*.txt")]:
        text = f.read_text("utf-8").replace("\r\n", "\n").replace("\n", "\r\n")
        f.write_text(text, encoding="utf-8-sig" if f.suffix == ".txt" else "ascii", newline="")
    sources = json.loads(args.sources.read_text("utf-8"))["sources"]
    runtime = runtime_fingerprint(site, stage / "AnimaBackend" / "models")
    (stage / "launcher" / "version.json").write_text(
        json.dumps({"version": args.version, "runtime": runtime, "sources": sources}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    step("压缩")
    name = f"AnimaVN-{args.version}{tag}"
    for old in out.glob("AnimaVN-*.zip"):
        old.unlink()
    # 整合包 = 外层几十个文件(资源管理器几秒解完)+ 里面一个 runtime.zip(第一次启动时 Python 自己解)
    inner = files_of(stage, RUNTIME_ITEMS)
    runtime_zip = out / RUNTIME_ZIP
    write_zip(runtime_zip, stage, inner)
    outer = sorted(set(files_of(stage, [""])) - set(inner))
    full = write_zip(out / f"{name}-windows.zip", stage, outer, prefix=stage.name, extra=runtime_zip)
    runtime_zip.unlink()
    upd = write_zip(out / f"{name}-update.zip", stage, files_of(stage, UPDATE_ITEMS), prefix=stage.name)
    (out / "latest.json").write_text(
        json.dumps({"version": args.version, "runtime": runtime, "full": full, "update": upd},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    files = sum(1 for f in stage.rglob("*") if f.is_file())
    print(f"\n版本 {args.version},运行环境 {runtime}")
    print(f"解压后 {mb(size_of(stage))}({files} 个文件)")
    print(f"整合包 {full['file']}  {mb(full['size'])}")
    print(f"更新包 {upd['file']}  {mb(upd['size'])}")
    print(f"用了 {time.time() - t0:.0f} 秒,东西在 {out}")


if __name__ == "__main__":
    main()
