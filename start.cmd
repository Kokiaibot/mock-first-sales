@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 3 秒後に管理画面をブラウザで開く
start "" /b cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:8787/"
call npm start
pause
