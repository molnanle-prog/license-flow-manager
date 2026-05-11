@echo off
title LicenseFlow Manager - Final Bundler
echo ======================================================
echo  LicenseFlow Manager v1.1.0 EXE Bundler
echo ======================================================

:: 1. Web Build (Vite)
echo [1/3] Building Web Assets (Vite)...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Web build returned non-zero exit code. 
    echo Checking if dist/index.html exists...
    if exist "dist\index.html" (
        echo [INFO] dist/index.html found. Proceeding to EXE bundling...
    ) else (
        echo [ERROR] Web build failed and no dist folder found.
        pause
        exit /b 1
    )
)

:: 2. Dependency Check (Python)
echo [2/3] Checking Python Dependencies...
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "PYTHON_CMD=python"
) else (
    set "PYTHON_CMD=py"
)

%PYTHON_CMD% -m pip install pyinstaller pywebview >nul 2>&1

:: 3. Build EXE (PyInstaller)
echo [3/3] Bundling with PyInstaller...
%PYTHON_CMD% -m PyInstaller --noconfirm --clean ^
    --name "LicenseFlow_Manager" ^
    --onefile ^
    --windowed ^
    --add-data "dist;dist" ^
    --add-data "launcher.json;." ^
    ManagerLauncher.py

if %ERRORLEVEL% neq 0 (
    echo [ERROR] EXE build failed.
    pause
    exit /b 1
)

echo ======================================================
echo [SUCCESS] Launcher built: dist\LicenseFlow_Manager.exe
echo ======================================================
pause
