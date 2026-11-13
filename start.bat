@echo off
title Dank Farm Bot
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required ^(v18+^).
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

if "%BOT_TOKEN%"=="" if not exist "config.json" (
    echo No BOT_TOKEN env var and no config.json found.
    echo Copy .env.example to .env, or create config.json.
    pause
    exit /b 1
)

echo Starting Dank Farm bot...
node index.js
pause