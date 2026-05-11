@echo off
setlocal enabledelayedexpansion
:: [NEW] ?ㅽ듃?뚰겕 寃쎈줈(UNC) ?ㅽ뻾 ?명솚???뺣낫
pushd "%~dp0"
title LicenseFlow Manager - ?ㅼ튂 ?꾨줈洹몃옩
color 0a

echo ======================================================
echo          LicenseFlow Manager v1.1.0 ?ㅼ튂
echo ======================================================

set "APP_NAME=LicenseFlow_Manager"
set "INSTALL_DIR=%LOCALAPPDATA%\%APP_NAME%"
set "EXE_NAME=LicenseFlow_Manager.exe"

echo [1/4] 湲곗〈 ?꾨줈?몄뒪 醫낅즺 諛??ㅼ튂 寃쎈줈 以鍮?..
taskkill /f /im "%EXE_NAME%" >nul 2>&1
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] ?꾨줈洹몃옩 ?뚯씪 蹂듭궗 以?..
:: 湲곗〈 ?뚯씪???덉쑝硫???뼱?곌린 (/y ?듭뀡)
copy /y "%~dp0%EXE_NAME%" "%INSTALL_DIR%\"
if %ERRORLEVEL% neq 0 (
    echo [?ㅻ쪟] ?뚯씪 蹂듭궗???ㅽ뙣?덉뒿?덈떎. 愿由ъ옄 沅뚰븳?쇰줈 ?ㅽ뻾??蹂댁꽭??
    pause
    exit /b 1
)

echo [3/4] 諛뷀깢?붾㈃ 諛붾줈媛湲??앹꽦 以?..
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\LicenseFlow Manager.lnk"
set "TARGET_PATH=%INSTALL_DIR%\%EXE_NAME%"
set "SCRIPT_PATH=%TEMP%\CreateShortcut.ps1"

echo $s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT_PATH%') > "%SCRIPT_PATH%"
echo $s.TargetPath='%TARGET_PATH%' >> "%SCRIPT_PATH%"
echo $s.WorkingDirectory='%INSTALL_DIR%' >> "%SCRIPT_PATH%"
echo $s.Save() >> "%SCRIPT_PATH%"

powershell -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
del "%SCRIPT_PATH%"

echo [4/4] ?쒖옉 ?꾨줈洹몃옩(?덉??ㅽ듃由? ?깅줉 以?..
set "REG_PATH=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
reg add "%REG_PATH%" /v "%APP_NAME%" /t REG_SZ /d "\"%TARGET_PATH%\"" /f >nul 2>&1

echo [?꾨즺] ?꾨줈洹몃옩 ?ㅽ뻾 以?..
start "" "%TARGET_PATH%"

echo ======================================================
echo          ?ㅼ튂媛 ?깃났?곸쑝濡??꾨즺?섏뿀?듬땲??
echo   [?꾩슜 ?대뜑] %INSTALL_DIR%
echo   諛뷀깢?붾㈃???앹꽦??諛붾줈媛湲곕? ?댁슜??二쇱꽭??
echo   ?댁젣 遺?????먮룞?쇰줈 ?꾨줈洹몃옩???ㅽ뻾?⑸땲??
echo ======================================================
pause
