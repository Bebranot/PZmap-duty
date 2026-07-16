@echo off
cd /d "%~dp0"
echo Starting PZmap proxy server...
start "" http://localhost:8880/pzmap.html
python proxy_server.py
pause
