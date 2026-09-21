@echo off
REM Lance pulldocker.ps1 : pull + rebuild/redeploiement Docker sur le serveur
REM distant defini dans pulldocker.ini. Fichier local uniquement (voir .gitignore).
TITLE Deploiement Docker distant
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulldocker.ps1"
echo.
pause
