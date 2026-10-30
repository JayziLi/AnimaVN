@echo off
rem Double-click to play: opens the AnimaVN launcher (its own window, no console).
rem The first time this window unpacks the runtime first (a minute or two), then closes by itself.
rem To play in a console + browser instead (the old way): python\python.exe launcher\start.py
rem ASCII only in this file to avoid codepage mojibake.
title AnimaVN
cd /d "%~dp0"
python\python.exe launcher\start.py --unpack-only
if errorlevel 1 (
  pause
  exit /b 1
)
start "" python\pythonw.exe launcher\gui.py
