@echo off
rem Double-click to open the AnimaVN launcher. It starts the background (host.py: backend + game page,
rem no console windows; output on the launcher's Console page); Start opens the game in its own window (game.py).
rem Settings - Developer picks the packed page (the old play.bat) or the dev server (the old start.bat).
rem ASCII only in this file to avoid codepage mojibake.
cd /d "%~dp0"
set PY=AnimaBackend\.venv\Scripts\python.exe
if not exist "%PY%" (
  echo AnimaBackend\.venv is missing - set up the backend first ^(see README^).
  pause
  exit /b 1
)
"%PY%" -c "import webview, qrcode" 2>nul || (
  echo Installing the launcher's packages ^(one time^)...
  "%PY%" -m pip install "pywebview>=6.2" "qrcode>=8" || (pause & exit /b 1)
)
start "" AnimaBackend\.venv\Scripts\pythonw.exe packaging\windows\payload\launcher\gui.py
