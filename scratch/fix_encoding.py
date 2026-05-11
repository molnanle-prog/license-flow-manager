
import os

content = """@echo off
setlocal enabledelayedexpansion
title LicenseFlow Manager - 설치 프로그램
color 0a

echo ======================================================
echo          LicenseFlow Manager v1.0.0 설치
echo ======================================================

set "APP_NAME=LicenseFlowManager"
set "INSTALL_DIR=%LOCALAPPDATA%\\%APP_NAME%"
set "EXE_NAME=LicenseFlow_Manager.exe"

echo [1/4] 기존 프로세스 종료 및 설치 경로 준비...
taskkill /f /im "%EXE_NAME%" >nul 2>&1
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] 프로그램 파일 복사 중...
:: 기존 파일이 있으면 덮어쓰기 (/y 옵션)
copy /y "%~dp0%EXE_NAME%" "%INSTALL_DIR%\\"
if %ERRORLEVEL% neq 0 (
    echo [오류] 파일 복사에 실패했습니다. 관리자 권한으로 실행해 보세요.
    pause
    exit /b 1
)

echo [3/4] 바탕화면 바로가기 생성 중...
set "SHORTCUT_PATH=%USERPROFILE%\\Desktop\\LicenseFlow Manager.lnk"
set "TARGET_PATH=%INSTALL_DIR%\\%EXE_NAME%"
set "SCRIPT_PATH=%TEMP%\\CreateShortcut.ps1"

echo $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT_PATH%') > "%SCRIPT_PATH%"
echo $s.TargetPath='%TARGET_PATH%' >> "%SCRIPT_PATH%"
echo $s.WorkingDirectory='%INSTALL_DIR%' >> "%SCRIPT_PATH%"
echo $s.Save() >> "%SCRIPT_PATH%"

powershell -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
del "%SCRIPT_PATH%"

echo [4/4] 시작 프로그램(레지스트리) 등록 중...
set "REG_PATH=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
reg add "%REG_PATH%" /v "%APP_NAME%" /t REG_SZ /d "\\"%TARGET_PATH%\\"" /f >nul 2>&1

echo [완료] 프로그램 실행 중...
start "" "%TARGET_PATH%"

echo ======================================================
echo          설치가 성공적으로 완료되었습니다!
echo   [전용 폴더] %INSTALL_DIR%
echo   바탕화면에 생성된 바로가기를 이용해 주세요.
echo   이제 부팅 시 자동으로 프로그램이 실행됩니다.
echo ======================================================
pause
"""

# Write as ANSI (CP949)
with open("install_setup.bat", "w", encoding="cp949") as f:
    f.write(content)

print("install_setup.bat has been rewritten in ANSI (CP949).")
