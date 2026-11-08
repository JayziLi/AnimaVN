# 把 AnimaVN 的 GSV 小插件装进解压好的 GPT-SoVITS 目录
# 用法: 双击 "装到GSV里.bat",或 powershell -File install.ps1 [-GsvRoot <目录>] [-Remote] [-NoShortcut] [-NoStart]
param(
    [string]$GsvRoot = '',
    [switch]$Remote,
    [switch]$NoShortcut,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot   # 放着 api_v2_anima.py 和 anima_gsv_routes.py 的目录

function Test-Gsv([string]$dir) {
    return ($dir -ne '') -and (Test-Path -LiteralPath (Join-Path $dir 'runtime\python.exe')) -and (Test-Path -LiteralPath (Join-Path $dir 'api_v2.py'))
}

if ($GsvRoot -eq '') {
    $up = Split-Path -Parent $src
    if (Test-Gsv $up) {
        $GsvRoot = $up
    } else {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = '选 GPT-SoVITS 解压后的文件夹(里面有 runtime 和 api_v2.py)'
        if ($dlg.ShowDialog() -ne 'OK') { exit 1 }
        $GsvRoot = $dlg.SelectedPath
    }
}

if (-not (Test-Gsv $GsvRoot)) {
    Write-Host '这不是解压好的 GPT-SoVITS 目录'
    exit 1
}

if (-not $PSBoundParameters.ContainsKey('Remote')) {
    try {
        $ans = Read-Host '别的电脑也要连这台吗? (y/N)'
        $Remote = ($ans -match '^[yY]')
    } catch {
        $Remote = $false
    }
}

foreach ($name in 'api_v2_anima.py', 'anima_gsv_routes.py') {
    Copy-Item -LiteralPath (Join-Path $src $name) -Destination (Join-Path $GsvRoot $name) -Force
}

# 配对码:有就不动
$pairFile = Join-Path $GsvRoot 'anima_pair.txt'
$utf8 = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path -LiteralPath $pairFile) -or ([IO.File]::ReadAllText($pairFile).Trim() -eq '')) {
    $chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] 1
    $code = ''
    while ($code.Length -lt 8) {
        $rng.GetBytes($buf)
        $limit = 256 - (256 % $chars.Length)
        if ($buf[0] -lt $limit) { $code += $chars[$buf[0] % $chars.Length] }
    }
    [IO.File]::WriteAllText($pairFile, $code, $utf8)
}
$pair = [IO.File]::ReadAllText($pairFile).Trim()

# 启动用的 bat(只放 ASCII)
$hostAddr = if ($Remote) { '0.0.0.0' } else { '127.0.0.1' }
$bat = Join-Path $GsvRoot 'start-animavn-voice.bat'
$lines = @(
    '@echo off',
    'cd /d "%~dp0"',
    "runtime\python.exe api_v2_anima.py -a $hostAddr -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml",
    'pause'
)
[IO.File]::WriteAllText($bat, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)

if (-not $NoShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop '启动 AnimaVN 语音.lnk'))
    $lnk.TargetPath = $bat
    $lnk.WorkingDirectory = $GsvRoot
    $lnk.Save()
}

Write-Host ''
Write-Host '装好了。'
Write-Host '接口地址: http://127.0.0.1:9880'
if ($Remote) {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }
    foreach ($ip in $ips) { Write-Host ("别的电脑填: http://{0}:9880" -f $ip.IPAddress) }
    Write-Host "配对码: $pair"
    Write-Host '只有局域网和 Tailscale 能传文件'
}

if (-not $NoStart) {
    $go = Read-Host '现在启动吗? (y/N)'
    if ($go -match '^[yY]') { Start-Process -FilePath $bat -WorkingDirectory $GsvRoot }
}
