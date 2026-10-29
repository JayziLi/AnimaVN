"""启动器跑在哪:整合包(python\\ + launcher\\ 在同一层)还是源码文件夹(packaging\\windows\\payload\\launcher)。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Layout:
    kind: str  # "portable" 整合包 / "repo" 源码文件夹
    root: Path
    python: Path  # 跑后端用的 python.exe(控制台程序;要黑窗口时也是它)
    launcher: Path  # launcher 文件夹

    @property
    def backend(self) -> Path:
        return self.root / "AnimaBackend"

    @property
    def data(self) -> Path:
        return self.backend / "data"  # 存档;启动器的设置、日志、锁也放这里

    @property
    def frontend(self) -> Path:
        return self.root / "frontend"  # 只有源码文件夹有

    @property
    def settings_file(self) -> Path:
        return self.data / "launcher.json"

    @property
    def logs(self) -> Path:
        return self.data / "logs"


def detect(launcher_dir: Path) -> Layout:
    launcher_dir = Path(launcher_dir).resolve()
    up = launcher_dir.parent
    if (up / "python" / "python.exe").is_file():
        return Layout("portable", up, up / "python" / "python.exe", launcher_dir)
    if len(launcher_dir.parents) > 3:
        root = launcher_dir.parents[3]
        venv = root / "AnimaBackend" / ".venv" / "Scripts" / "python.exe"
        if venv.is_file() and (root / "frontend").is_dir():
            return Layout("repo", root, venv, launcher_dir)
    raise RuntimeError(f"认不出这是整合包还是源码文件夹:{launcher_dir}")
