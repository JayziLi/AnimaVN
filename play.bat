@echo off
rem Double-click to PLAY. Builds the frontend (about a second) and serves the built files on
rem http://localhost:5180 - several times lighter than the dev server start.bat runs (no React
rem development checks, no double rendering), so the game stays smooth while the AI is writing.
rem start.bat is for changing code; this one is for playing. Both can run at the same time.
rem Every double-click rebuilds, so code changes show up the next time you open this.
rem ASCII only in this file to avoid codepage mojibake.
rem --host so phones on the same Wi-Fi can open http://[this PC's LAN IP]:5180

rem 1. Backend: reuse the one start.bat (or an earlier play.bat) started, otherwise start one.
curl.exe -s -o nul --noproxy "*" http://127.0.0.1:8000/api/health
if errorlevel 1 start "AnimaBackend" cmd /k "echo AnimaBackend API: http://localhost:8000 && cd /d %~dp0AnimaBackend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

rem 2. Build. Only real build errors stop here (type checking is left to start.bat / npm run build).
echo Building the game...
pushd "%~dp0frontend"
call npx vite build --logLevel error
if errorlevel 1 goto buildfailed
popd

rem 3. Serve the build. If the play server is already running it picks up the new files by itself.
curl.exe -s -o nul --noproxy "*" http://127.0.0.1:5180/debug.html
if errorlevel 1 start "AnimaVN Play" cmd /k "echo AnimaVN (play build): http://localhost:5180/debug.html && cd /d %~dp0frontend && npx vite preview --host --port 5180 --strictPort"

rem 4. Wait until both answer (1s apart, give up after 90s), then open the game.
echo Waiting for AnimaBackend and the game page to come up...
set tries=0
set waited=0
:wait
set /a tries+=1
if %tries% gtr 90 (
  echo Servers did not respond within 90s - check the server windows for errors.
  pause
  exit /b 1
)
curl.exe -s -o nul --noproxy "*" http://127.0.0.1:8000/api/health || goto retry
curl.exe -s -o nul --noproxy "*" http://127.0.0.1:5180/debug.html || goto retry
start "" http://localhost:5180/debug.html
exit /b 0

:retry
rem Same as start.bat: a big database upgrade can keep the backend busy for minutes.
if exist "%~dp0AnimaBackend\data\animabackend.db.migrating" if %waited% lss 1800 (
  if not defined upgrading echo Upgrading the database - this can take a few minutes, please wait...
  set upgrading=1
  set tries=0
  set /a waited+=1
)
ping -n 2 127.0.0.1 >nul
goto wait

:buildfailed
popd
echo Build failed - see the messages above. start.bat still works for playing meanwhile.
pause
exit /b 1
