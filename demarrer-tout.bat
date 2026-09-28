@echo off
setlocal
title VibeDelib - demarrage local

REM Lance chaque service dans sa propre fenetre pour voir les logs.
start "Backend VibeDelib (3121)" /D "%~dp0backend" cmd /k "npm run dev"
start "Frontend agents (5160)" /D "%~dp0frontend" cmd /k "npm run dev"
start "Frontend elus (5161)" /D "%~dp0elus-dmz" cmd /k "npm run dev"

echo Backend : http://localhost:3121
echo Agents  : http://localhost:5160
echo Elus    : http://localhost:5161
endlocal
