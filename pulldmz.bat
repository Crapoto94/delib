@echo off
REM Lance pulldmz.ps1 : copie elus-dmz/ (fichiers suivis par git) sur le
REM serveur DMZ puis reconstruit/relance le conteneur. Fichier local
REM uniquement (voir .gitignore).
TITLE Deploiement DMZ (elus-dmz)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulldmz.ps1" -IniPath "%~dp0pulldmz.ini"
echo.
pause
