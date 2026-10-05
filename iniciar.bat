@echo off
setlocal
title WA Games - IA de Gols
cd /d "%~dp0"

echo ========================================
echo   WA GAMES - IA DE DETECCION DE GOLS
echo ========================================
echo.

rem --- Verifica que Node.js exista ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No se encontro Node.js en el PATH.
    echo         Instala Node.js desde https://nodejs.org y reintenta.
    pause
    exit /b 1
)

rem --- Elige el Python del entorno virtual si existe ---
set "PYTHON=python"
if exist ".venv\Scripts\python.exe" set "PYTHON=.venv\Scripts\python.exe"

rem --- Fuerza UTF-8 para que los emojis no rompan la consola ---
set "PYTHONIOENCODING=utf-8"

echo [1/2] Iniciando API de IA (Python + Flask) en el puerto 5000...
echo.
start "API IA" cmd /k "cd projeto && ..\%PYTHON% api.py"

echo [2/2] Iniciando Servidor Node.js en el puerto 3000...
echo.
start "Servidor Node" cmd /k "node server.js"

echo.
echo ========================================
echo   TODO INICIADO!
echo   Abre el navegador en: http://localhost:3000
echo ========================================
echo.
pause