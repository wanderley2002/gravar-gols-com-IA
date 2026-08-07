@echo off
title WA Games - IA de Gols
echo ========================================
echo    WA GAMES - IA DE DETECCAO DE GOLS
echo ========================================
echo.

echo [1/2] Iniciando API de IA (Python/Flask)...
echo.
start "API IA" cmd /k "cd projeto && python api.py"

echo [2/2] Iniciando Servidor Node.js...
echo.
start "Servidor Node" cmd /k "node server.js"

echo.
echo ========================================
echo   TUDO INICIADO!
echo   Abra o navegador em: http://localhost:3000
echo ========================================
echo.
pause