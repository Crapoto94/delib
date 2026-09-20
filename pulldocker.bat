@echo off
REM Lance pulldocker.ps1 : git pull + rebuild/redéploiement Docker de VibeDélib sur le serveur défini dans pulldocker.ini.
TITLE Deploiement Docker VibeDelib
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulldocker.ps1"
echo.
pause
