@echo off
REM Lance pulldmz.ps1 avec pulldmz-lan.ini : copie elus-dmz/ sur le serveur LAN
REM (meme machine que le backend), port 5161, pour un acces interne en
REM attendant l'ouverture du pare-feu DMZ->LAN. Fichier local uniquement.
TITLE Deploiement LAN (elus-dmz)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulldmz.ps1" -IniPath "%~dp0pulldmz-lan.ini"
echo.
pause
