# 在桌面放一个启动器快捷方式(源码文件夹用):双击 = pythonw 开 gui.py,不弹黑窗口,图标是 AnimaVN 的。
# 右键「使用 PowerShell 运行」,或者 powershell -File packaging\windows\make_shortcut.ps1 [-Name 名字]
# 快捷方式指向的是这个脚本所在的源码文件夹;换了文件夹(比如分身合回主文件夹)重跑一次就行
param([string]$Name = "AnimaVN")
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$pyw = Join-Path $root "AnimaBackend\.venv\Scripts\pythonw.exe"
$gui = Join-Path $root "packaging\windows\payload\launcher\gui.py"
$ico = Join-Path $root "packaging\windows\payload\launcher\AnimaVN.ico"
if (-not (Test-Path $pyw)) { throw "没找到 $pyw ,先双击一次 start.bat 把环境装好" }
$desk = [Environment]::GetFolderPath("Desktop")
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk "$Name.lnk"))
$lnk.TargetPath = $pyw
$lnk.Arguments = "`"$gui`""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$ico,0"
$lnk.Description = "AnimaVN 启动器 · $root"
$lnk.Save()
"已放到桌面:$Name.lnk -> $root"
