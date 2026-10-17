@echo off
rem Double-click to play: starts the game and opens it in the browser. Close this window to quit.
rem ASCII only in this file to avoid codepage mojibake.
title AnimaVN
cd /d "%~dp0"
python\python.exe launcher\start.py %*
if errorlevel 1 pause
