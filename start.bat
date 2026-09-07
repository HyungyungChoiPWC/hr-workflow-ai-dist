@echo off
title HR Workflow Builder
:: =====================================================
::  HR Workflow Builder - Quick Start (Windows)
::  Double-click this file to install and run.
:: =====================================================

cd /d "%~dp0"

echo.
echo =====================================================
echo   HR Workflow Builder - Starting...
echo =====================================================
echo.

:: -- 1. Check Node.js --
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo.
    echo   Please install Node.js LTS from:
    echo   ^>^> https://nodejs.org/
    echo.
    echo   After installation, double-click this file again.
    echo.
    start https://nodejs.org/ko
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% detected.

:: -- 2. Check npm --
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not found. Please reinstall Node.js.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo [OK] npm v%NPM_VER% detected.

:: -- 3. Install dependencies if needed --
if not exist "node_modules" (
    echo.
    echo [INFO] Installing dependencies - first run only, may take 2-3 min...
    echo.
    call npm install --legacy-peer-deps
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Check your network connection.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed successfully.
) else (
    echo [OK] Dependencies already installed.
)

:: -- 4. Auto-open browser after 3 seconds --
start /b "" cmd /min /c "timeout /t 3 /nobreak >nul 2>&1 && start http://localhost:3000"

:: -- 5. Start dev server --
echo.
echo =====================================================
echo   Server starting...
echo   URL: http://localhost:3000
echo   Stop: Close this window or press Ctrl+C
echo =====================================================
echo.

call npm run dev -- --turbopack -p 3000

echo.
echo [INFO] Server stopped.
pause
