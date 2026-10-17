@echo off
rem Double-click to update the game (saves are kept). ASCII only in this file.
rem The real work is one line on purpose: the updater replaces this very file, and cmd keeps
rem reading a batch file from the old position after each command returns.
title AnimaVN update
cd /d "%~dp0" & python\python.exe launcher\update.py & pause & exit /b
