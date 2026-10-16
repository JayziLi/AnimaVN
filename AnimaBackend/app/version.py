"""程序版本号:/api/health、迁移账本(哪一版做的这一步)、设置页共用。"""

from importlib import metadata


def app_version() -> str:
    try:
        return metadata.version("animabackend")
    except metadata.PackageNotFoundError:
        return "0.1.0"  # dev checkout without editable install — keep in sync with pyproject.toml
