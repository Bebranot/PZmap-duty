@echo off
rem Keeps app.py running: if it crashes or the machine reboots and this
rem batch is registered as a scheduled task, it just restarts in a loop
rem instead of leaving the map down with nobody around to relaunch it.
cd /d "%~dp0"
:loop
python app.py
echo app.py exited, restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
