@echo off
setlocal enabledelayedexpansion
title LicenseFlow Manager - Setup Builder
cd /d "%~dp0"

echo [0/4] Clean old exe in dist...
if not exist "dist" mkdir "dist"
if exist "dist\LicenseFlow_Manager.exe" del /f /q "dist\LicenseFlow_Manager.exe"
if exist "dist\LicenseFlow_Manager_Setup.exe" del /f /q "dist\LicenseFlow_Manager_Setup.exe"
if exist "LicenseFlow_Manager_Setup.exe" del /f /q "LicenseFlow_Manager_Setup.exe"

echo [1/4] npm run build...
call npm run build
if %ERRORLEVEL% neq 0 exit /b 1
where python >nul 2>&1 && set PYTHON_CMD=python || set PYTHON_CMD=py
echo [1b/4] Fix UTF-8 for login-helper.html...
%PYTHON_CMD% "%~dp0scripts\fix_dist_utf8.py"
echo [2/4] pip install pyinstaller pywebview...
%PYTHON_CMD% -m pip install -U pyinstaller pywebview >nul 2>&1
echo [3/4] PyInstaller...
taskkill /f /im LicenseFlow_Manager.exe /t >nul 2>&1
%PYTHON_CMD% -m PyInstaller --noconfirm --clean --name LicenseFlow_Manager --onefile --windowed --add-data "dist;dist" --add-data "launcher.json;." ManagerLauncher.py
if %ERRORLEVEL% neq 0 exit /b 1
echo [4/4] Inno Setup...
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup.iss
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
  "C:\Program Files\Inno Setup 6\ISCC.exe" setup.iss
) else (
  echo Inno Setup not found. EXE only: dist\LicenseFlow_Manager.exe
  exit /b 1
)
if exist "dist\LicenseFlow_Manager_Setup.exe" (
  echo.
  echo [SUCCESS] dist\LicenseFlow_Manager_Setup.exe
) else (
  echo [ERROR] Installer build failed.
  exit /b 1
)
