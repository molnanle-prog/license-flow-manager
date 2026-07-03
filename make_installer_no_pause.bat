@echo off
setlocal enabledelayedexpansion
title LicenseFlow - Standalone Build Script
color 0b

echo ======================================================
echo          LicenseFlow Manager v1.2.9 빌드
echo ======================================================

:: 1. Node.js check
echo [Step 1] Checking Node.js...
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed.
    
    exit /b 1
)

:: 2. Frontend build
echo [Step 2] Building React Frontend...
set NODE_OPTIONS=--max-old-space-size=4096
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed.
    
    exit /b 1
)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] vite build failed.
    
    exit /b 1
)

:: 3. Python check
echo [Step 3] Checking Python environment...
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed.
    
    exit /b 1
)

:: 3.1 Install PyInstaller
echo [Step 3.1] Installing Python dependencies...
python -m pip install -U pyinstaller pywebview gspread oauth2client firebase-admin >nul 2>&1

:: 4. PyInstaller build
echo [Step 4] Building Final Standalone EXE (LicenseFlow_Manager)...
if exist "dist\LicenseFlow_Manager.exe" del /f /q "dist\LicenseFlow_Manager.exe"
if exist "dist\LicenseFlow_Manager_Setup.exe" del /f /q "dist\LicenseFlow_Manager_Setup.exe"
python -m PyInstaller --onefile --noconsole --name LicenseFlow_Manager --add-data "dist;dist" --add-data "launcher.json;." --icon="NONE" ManagerLauncher.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PyInstaller build failed.
    
    exit /b 1
)

:: 4.1 Inno Setup installer
echo [Step 4.1] Building Setup Installer (LicenseFlow_Manager_Setup.exe)...
taskkill /f /im "LicenseFlow_Manager.exe" /t >nul 2>&1
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    "C:\Program Files\Inno Setup 6\ISCC.exe" setup.iss
) else (
    echo [WARN] Inno Setup not found. Skipping Setup.exe (standalone exe only).
)
if not exist "dist\LicenseFlow_Manager_Setup.exe" (
    echo [ERROR] LicenseFlow_Manager_Setup.exe was not created.
    exit /b 1
)

:: 5. Packaging
echo [Step 5] Finalizing Package (v1.2.9)...
set "RELEASE_DIR=LicenseFlow_Release_v1.2.9"

:: [PROCESS KILL] 종료 로직
taskkill /f /im "LicenseFlow_Manager.exe" /t >nul 2>&1

if exist "%RELEASE_DIR%" (
    echo [Cleanup] Removing old release folder...
    rd /s /q "%RELEASE_DIR%"
)
timeout /t 1 /nobreak >nul
mkdir "%RELEASE_DIR%"

echo [Copy] Copying files to release folder...
copy /y "dist\LicenseFlow_Manager.exe" "%RELEASE_DIR%\"
if exist "dist\LicenseFlow_Manager_Setup.exe" (
    copy /y "dist\LicenseFlow_Manager_Setup.exe" "%RELEASE_DIR%\"
)
if exist "install_setup.bat" (
    copy /y "install_setup.bat" "%RELEASE_DIR%\"
) else if exist "설치하기.bat" (
    copy /y "설치하기.bat" "%RELEASE_DIR%\"
)

echo ======================================================
echo [SUCCESS] Build Complete!
echo [Location] %RELEASE_DIR%\LicenseFlow_Manager_Setup.exe
echo [Mode] Windows Setup Installer (Recommended for upgrades)
echo [Features] v1.2.9 Integrated / Safe upgrade (taskkill before install)
echo ======================================================

