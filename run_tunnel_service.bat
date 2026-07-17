@echo off
rem Keeps the Cloudflare quick tunnel running. Note: the public HTTPS URL
rem changes every time this restarts (quick tunnels don't have a stable
rem hostname without a Cloudflare account + domain) — check cloudflared's
rem own output/log for the current https://*.trycloudflare.com URL after
rem each restart and re-share it with the group.
cd /d "%~dp0"
:loop
cloudflared.exe tunnel --url http://localhost:8880
echo cloudflared exited, restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
