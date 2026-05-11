
import React, { useState, useEffect } from 'react';
import { getProducts, getAppConfig, getCurrentProgram } from '../services/storageService';
import { Product } from '../types';
import { getUniversalLauncherCode, getLauncherConfigJSON } from '../services/integrationTemplates';

const IntegrationGuide: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [step, setStep] = useState<1 | 2>(1); // 1: Build Wrapper, 2: Distribute
  
  const appConfig = getAppConfig();
  const currentProgram = getCurrentProgram();

  useEffect(() => {
    const fetchProds = async () => {
      const prods = await getProducts();
      setProducts(prods);
      if (prods.length > 0 && !selectedProductId) {
        setSelectedProductId(prods[0].id);
      }
    };
    fetchProds();
  }, []);

  const selectedProduct = products.find(p => p.id === selectedProductId) || null;
  const currentSheetId = currentProgram?.sheetId || "SHEET_ID_NOT_FOUND";

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다!');
  };

  const handleDownload = (filename: string, content: string) => {
    const element = document.createElement('a');
    
    const isBatch = filename.endsWith('.bat');
    let finalContent = content;

    if (isBatch) {
        finalContent = content.replace(/\r?\n/g, "\r\n");
    }

    const blobContent = isBatch ? [finalContent] : ['\uFEFF' + content];
    
    const file = new Blob(blobContent, {type: 'text/plain;charset=utf-8'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // [Update] Batch file with CD logic and Fixed Quotes, REMOVED KOREAN CHARACTERS to prevent encoding issues
  const batchFileContent = `@echo off
setlocal enabledelayedexpansion
title LicenseGuard Builder

:: Move to script directory
cd /d "%~dp0"

echo.
echo ======================================================
echo          LicenseGuard EXE Build Tool
echo ======================================================
echo.

:: --------------------------------------------------------
:: 0. Python Check logic
:: --------------------------------------------------------
echo [Step 0] Checking Python environment...
set "PYTHON_CMD="

:: 1. Try 'python' command
python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=python"
    goto :FOUND_PYTHON
)

:: 2. Try 'py' command
py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
    goto :FOUND_PYTHON
)

:: 3. Try Microsoft Store Path
if exist "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\python.exe" (
    set "PYTHON_CMD=%LOCALAPPDATA%\\Microsoft\\WindowsApps\\python.exe"
    goto :FOUND_PYTHON
)

:: 4. Try Common Paths manually
if exist "C:\\Python312\\python.exe" set "PYTHON_CMD=C:\\Python312\\python.exe" & goto :FOUND_PYTHON
if exist "C:\\Python311\\python.exe" set "PYTHON_CMD=C:\\Python311\\python.exe" & goto :FOUND_PYTHON
if exist "C:\\Python310\\python.exe" set "PYTHON_CMD=C:\\Python310\\python.exe" & goto :FOUND_PYTHON
if exist "C:\\Program Files\\Python312\\python.exe" set "PYTHON_CMD=C:\\Program Files\\Python312\\python.exe" & goto :FOUND_PYTHON
if exist "C:\\Program Files\\Python311\\python.exe" set "PYTHON_CMD=C:\\Program Files\\Python311\\python.exe" & goto :FOUND_PYTHON

:: 5. Manual Input Fallback
echo.
echo [WARNING] Could not find Python automatically.
echo.
echo Please manually enter the full path to python.exe.
echo Example: C:\\Users\\User\\AppData\\Local\\Programs\\Python\\Python312\\python.exe
echo.
set /p "USER_PATH=Python Path: "

set "USER_PATH=!USER_PATH:"=!"

if exist "!USER_PATH!" (
    set "PYTHON_CMD=!USER_PATH!"
    goto :FOUND_PYTHON
)

echo.
echo [ERROR] Python not found.
pause
exit /b

:FOUND_PYTHON
echo [Info] Using Python: "!PYTHON_CMD!"
echo.

:: --------------------------------------------------------
:: 1. Source Check
:: --------------------------------------------------------
if exist LicenseGuard.py goto :CHECK_CONFIG
echo.
echo [ERROR] LicenseGuard.py NOT found in this folder.
echo Current Folder: %CD%
echo.
echo Please download 'LicenseGuard.py' to this folder.
pause
exit /b

:CHECK_CONFIG
:: --------------------------------------------------------
:: 2. Config Bundle Check
:: --------------------------------------------------------
set "ADD_DATA_ARG="
if exist launcher.json (
    echo [INFO] 'launcher.json' found! Bundling it into the EXE.
    set ADD_DATA_ARG=--add-data "launcher.json;."
) else (
    echo [WARNING] 'launcher.json' NOT found in this folder.
    echo.
    echo Important:
    echo If you want a single standalone EXE, you MUST have
    echo 'launcher.json' in this folder BEFORE building.
    echo.
    echo Press any key to continue building WITHOUT bundling...
    pause >nul
)
echo.

:: --------------------------------------------------------
:: 3. Install Libraries
:: --------------------------------------------------------
echo [Step 1] Installing libraries...
"!PYTHON_CMD!" -m pip install --upgrade pip
"!PYTHON_CMD!" -m pip install pyinstaller gspread oauth2client

if errorlevel 1 (
    echo.
    echo [ERROR] Library installation failed.
    echo Please check your internet connection.
    pause
    exit /b
)

:: --------------------------------------------------------
:: 4. Build
:: --------------------------------------------------------
echo.
echo [Step 2] Building EXE file...
echo.

:: Run PyInstaller
"!PYTHON_CMD!" -m PyInstaller --onefile --noconsole --name="LicenseGuard" !ADD_DATA_ARG! LicenseGuard.py

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b
)

:: --------------------------------------------------------
:: 5. Cleanup
:: --------------------------------------------------------
echo.
echo [Step 3] Cleaning up...
if exist build rd /s /q build
if exist LicenseGuard.spec del /f /q LicenseGuard.spec

echo.
echo ======================================================
echo [SUCCESS] Build Complete!
echo ======================================================
echo.
echo 1. 'LicenseGuard.exe' has been created in 'dist' folder.
echo 2. Move this file to your distribution folder.
echo.
pause`;

  return (
    <div className="flex flex-col gap-6 animate-fade-in h-[calc(100vh-140px)]">
      
      {/* Header Info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-indigo-900 mb-1">
            <i className="fas fa-rocket mr-2"></i> 원클릭 런처 만들기
          </h2>
          <p className="text-sm text-indigo-700">
             소스 수정 없이 <strong>'설정 파일(json)'</strong>만 바꾸면 어떤 프로그램이든 인증 기능을 붙일 수 있습니다.
          </p>
        </div>
        <div className="flex bg-white rounded-lg p-1 border border-indigo-100">
           <button 
             onClick={() => setStep(1)}
             className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${step === 1 ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
           >
             1단계: 통합 빌드
           </button>
           <div className="w-px bg-gray-200 mx-1"></div>
           <button 
             onClick={() => setStep(2)}
             className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${step === 2 ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
           >
             2단계: 배포 방법
           </button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        
        {/* Step Content */}
        <div className="flex-1 flex flex-col bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          
          {/* Step 1 View */}
          {step === 1 && (
            <div className="flex flex-col h-full">
              <div className="p-6 border-b border-gray-100">
                <div className="flex flex-col gap-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">1단계: 파일 다운로드 및 빌드</h3>
                    <p className="text-sm text-gray-600">
                       아래 3개 파일을 <strong>모두 같은 폴더</strong>에 다운로드 받은 뒤, <code>build_launcher.bat</code>를 실행하세요.<br/>
                       <span className="text-indigo-600 font-bold">* launcher.json 파일이 있으면 자동으로 EXE 안에 포함됩니다! (단일 파일 배포 가능)</span>
                    </p>
                  </div>

                  {/* Config Selection Area */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                       <label className="block text-sm font-bold text-gray-700 mb-2">
                           <i className="fas fa-cog mr-1"></i> 어떤 제품용인가요? (설정 파일 생성)
                       </label>
                       <div className="flex gap-2">
                           <select 
                             className="flex-1 border border-gray-300 rounded-lg p-2 bg-white"
                             value={selectedProductId}
                             onChange={(e) => setSelectedProductId(e.target.value)}
                           >
                             {products.map(p => (
                               <option key={p.id} value={p.id}>{p.name}</option>
                             ))}
                           </select>
                           <button
                             onClick={() => handleDownload('launcher.json', getLauncherConfigJSON(selectedProduct, currentSheetId, currentProgram?.gasUrl || ''))}
                             className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 shadow-sm flex items-center whitespace-nowrap"
                           >
                             <i className="fas fa-download mr-2"></i> launcher.json 받기
                           </button>
                       </div>
                       <p className="text-xs text-gray-500 mt-2">
                           * 다운로드 받은 <code>launcher.json</code> 파일을 메모장으로 열어 <code>targetExecutable</code> (원본 프로그램 파일명)을 꼭 확인/수정하세요!
                       </p>
                  </div>
                  
                  <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => handleDownload('LicenseGuard.py', getUniversalLauncherCode(appConfig.privateKey, appConfig.clientEmail, currentProgram?.gasUrl || '', currentProgram?.securityToken || ''))}
                        className="bg-indigo-600 text-white px-5 py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-md flex items-center transition-transform hover:-translate-y-0.5"
                      >
                        <i className="fas fa-file-code mr-2 text-lg"></i> 
                        <div className="text-left">
                            <div className="text-xs opacity-80">소스 코드</div>
                            <div>LicenseGuard.py</div>
                        </div>
                      </button>

                      <button
                        onClick={() => handleDownload('build_launcher.bat', batchFileContent)}
                        className="bg-slate-700 text-white px-5 py-3 rounded-lg font-bold hover:bg-slate-800 shadow-md flex items-center transition-transform hover:-translate-y-0.5"
                      >
                        <i className="fas fa-tools mr-2 text-lg"></i> 
                        <div className="text-left">
                            <div className="text-xs opacity-80">빌드 도구</div>
                            <div>build_launcher.bat</div>
                        </div>
                      </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 bg-slate-900 overflow-hidden relative group p-6 flex flex-col justify-center items-center text-center">
                 <div className="max-w-md">
                     <i className="fas fa-laptop-code text-5xl text-slate-600 mb-6"></i>
                     <h3 className="text-xl font-bold text-white mb-2">빌드 준비 완료</h3>
                     <p className="text-slate-400 mb-6">
                         위 3개 파일을 한 폴더에 모으고 <br/>
                         <span className="text-white font-mono bg-slate-800 px-2 rounded">build_launcher.bat</span> 를 실행하면 끝입니다!
                     </p>
                     <div className="bg-slate-800 p-4 rounded-lg text-left text-sm text-slate-300 font-mono">
                         📂 내 다운로드 폴더<br/>
                         ├── 📄 LicenseGuard.py <span className="text-gray-500">(소스)</span><br/>
                         ├── ⚙️ launcher.json <span className="text-green-400">(설정 - 필수!)</span><br/>
                         └── 🔨 build_launcher.bat <span className="text-blue-400">(실행하세요)</span>
                     </div>
                 </div>
              </div>
            </div>
          )}

          {/* Step 2 View */}
          {step === 2 && (
            <div className="flex flex-col h-full p-8">
                <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">배포 준비 완료!</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto w-full">
                    {/* Scenario A: Bundled */}
                    <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6 flex flex-col items-center text-center hover:shadow-lg transition-shadow">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                            <i className="fas fa-box-open text-2xl text-green-600"></i>
                        </div>
                        <h4 className="font-bold text-lg text-green-900 mb-2">방법 A: 단일 파일 배포 (추천)</h4>
                        <p className="text-sm text-green-800 mb-4">
                            빌드할 때 폴더에 <code>launcher.json</code>이 있었다면,<br/>
                            설정이 EXE 안에 포함되었습니다.
                        </p>
                        <div className="bg-white p-4 rounded border border-green-200 text-left w-full text-sm">
                            <p className="font-bold text-gray-700 mb-2">📦 고객에게 전달할 폴더:</p>
                            <ul className="space-y-1 text-gray-600">
                                <li>📁 MyProgram</li>
                                <li className="pl-4">├── <i className="fab fa-windows text-blue-500"></i> <strong>Start.exe</strong> (빌드된 파일 이름 변경)</li>
                                <li className="pl-4">└── <i className="fas fa-cube text-gray-400"></i> MyOriginalApp.exe (원본)</li>
                            </ul>
                        </div>
                    </div>

                    {/* Scenario B: Separated */}
                    <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-6 flex flex-col items-center text-center hover:shadow-lg transition-shadow">
                        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                            <i className="fas fa-copy text-2xl text-gray-600"></i>
                        </div>
                        <h4 className="font-bold text-lg text-gray-800 mb-2">방법 B: 설정 파일 분리</h4>
                        <p className="text-sm text-gray-600 mb-4">
                            빌드 후 <code>launcher.json</code>을 따로 관리하고 싶다면,<br/>
                            EXE와 같은 폴더에 두면 됩니다.
                        </p>
                        <div className="bg-white p-4 rounded border border-gray-200 text-left w-full text-sm">
                            <p className="font-bold text-gray-700 mb-2">📦 고객에게 전달할 폴더:</p>
                            <ul className="space-y-1 text-gray-600">
                                <li>📁 MyProgram</li>
                                <li className="pl-4">├── <i className="fab fa-windows text-blue-500"></i> <strong>Start.exe</strong> (빌드된 파일)</li>
                                <li className="pl-4">├── <i className="fas fa-cog text-green-500"></i> <strong>launcher.json</strong> (설정 파일)</li>
                                <li className="pl-4">└── <i className="fas fa-cube text-gray-400"></i> MyOriginalApp.exe (원본)</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default IntegrationGuide;
