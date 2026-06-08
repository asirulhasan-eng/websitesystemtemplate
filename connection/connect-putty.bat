@echo off
:: =============================================================================
:: connect-putty.bat — Connect to the server using PuTTY (plink)
:: =============================================================================
:: Reads SERVER_HOST and SERVER_USER from server.cfg in this folder.
:: To change the server: edit server.cfg (NOT this script).
:: =============================================================================

:: Load server.cfg
set SERVER_HOST=
set SERVER_USER=root
set CFG=%~dp0server.cfg

if not exist "%CFG%" (
    echo [ERROR] server.cfg not found in %~dp0
    echo.
    echo  1. Copy server.cfg.example to server.cfg
    echo     copy "%~dp0server.cfg.example" "%~dp0server.cfg"
    echo  2. Edit server.cfg and set your SERVER_HOST and SERVER_USER
    echo.
    pause
    exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%CFG%") do (
    if /i "%%A"=="SERVER_HOST" set SERVER_HOST=%%B
    if /i "%%A"=="SERVER_USER" set SERVER_USER=%%B
)

if "%SERVER_HOST%"=="" (
    echo [ERROR] SERVER_HOST is not set in server.cfg
    pause
    exit /b 1
)

echo Connecting to %SERVER_USER%@%SERVER_HOST% (PuTTY) ...
plink -i "%~dp0key.ppk" %SERVER_USER%@%SERVER_HOST%
