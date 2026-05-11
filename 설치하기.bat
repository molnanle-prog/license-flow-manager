@echo off
setlocal enabledelayedexpansion
pushd "%~dp0"
title LicenseFlow Manager v1.1.0 ?�치 ?�로그램
color 0a

echo ======================================================
echo          LicenseFlow Manager v1.1.0 ?�치 ?�작
echo ======================================================

set "APP_NAME=LicenseFlow_Manager"
set "INSTALL_DIR=%LOCALAPPDATA%\LicenseFlow_Manager"
set "EXE_NAME=LicenseFlow_Manager.exe"

echo [1/4] 기존 ?�로?�스 종료 �??�치 경로 준�?..
taskkill /f /im "%EXE_NAME%" >nul 2>&1
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] ?�로그램 ?�일 복사 �?..
copy /y "%~dp0%EXE_NAME%" "%INSTALL_DIR%\"
if %ERRORLEVEL% neq 0 (
    echo [?�류] ?�일 복사???�패?�습?�다. 관리자 권한?�로 ?�행??보세??
    pause
    exit /b 1
)

echo [3/4] 바탕?�면 바로가�??�성 �?..
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\LicenseFlow Manager.lnk"
set "TARGET_PATH=%INSTALL_DIR%\%EXE_NAME%"
set "SCRIPT_PATH=%TEMP%\CreateShortcut.ps1"

echo $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT_PATH%') > "%SCRIPT_PATH%"
echo $s.TargetPath='%TARGET_PATH%' >> "%SCRIPT_PATH%"
echo $s.WorkingDirectory='%INSTALL_DIR%' >> "%SCRIPT_PATH%"
echo $s.Save() >> "%SCRIPT_PATH%"

powershell -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
del "%SCRIPT_PATH%"

echo [4/4] ?�작 ?�로그램 ?�록 �?..
set "REG_PATH=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
reg add "%REG_PATH%" /v "%APP_NAME%" /t REG_SZ /d "\"%TARGET_PATH%\"" /f >nul 2>&1

echo [?�료] ?�로그램 ?�행 �?..
start "" "%TARGET_PATH%"

echo ======================================================
echo          v1.1.0 ?�치가 ?�공?�으�??�료?�었?�니??
echo   [?�치 ?�더] %INSTALL_DIR%
echo   ?�제 부?????�동?�로 ?�로그램???�행?�니??
echo ======================================================
pause
