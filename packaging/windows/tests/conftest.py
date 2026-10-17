import sys
from pathlib import Path

# 整合包里的启动器 / 更新器是单独的脚本(不在 app 里),测试直接按文件夹导入
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "payload" / "launcher"))
