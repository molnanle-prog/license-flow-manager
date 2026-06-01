
import React, { useState, useEffect, useRef } from 'react';
import { testConnection, initializeSheetTabs, getAccessToken } from '../services/googleSheetService';
import { getAppConfig, saveAppConfig, cleanSheetId, syncCustomersFromLicenses, getLicenses, saveLicenses } from '../services/storageService';
import { sendLicenseEmail } from '../services/emailService';
import { playNotificationSound } from '../services/soundService';
import { AppConfig, ProgramConfig, PROGRAM_IDS } from '../types';

const Settings: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>({
    clientEmail: '',
    privateKey: '',
    programs: [],
    currentProgramId: '',
    emailJsServiceId: '',
    emailJsTemplateId: '',
    emailJsPublicKey: '',
    downloadLink: '',
    enableContactSync: false,
    googleSubjectEmail: ''
  });

  const [isSaved, setIsSaved] = useState(false);
  
  const [selectedProgramId, setSelectedProgramId] = useState<string | 'NEW' | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProgramConfig>>({});
  
  const [testing, setTesting] = useState(false);
  // Detailed log for connection diagnosis
  const [diagLog, setDiagLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testRecipient, setTestRecipient] = useState('');
  const [smsTesting, setSmsTesting] = useState(false);
  const [testSmsResult, setTestSmsResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testSmsRecipient, setTestSmsRecipient] = useState('');
  
  // [NEW] SMTP Guide Toggle
  const [showSmtpGuide, setShowSmtpGuide] = useState(false);
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PROGRAM_IDS>(PROGRAM_IDS.EZIMPO);
  const [gasTesting, setGasTesting] = useState<{[key in PROGRAM_IDS]?: boolean}>({});
  const [gasTestResult, setGasTestResult] = useState<{[key in PROGRAM_IDS]?: {success: boolean, message: string} | null}>({});

  useEffect(() => {
    const loaded = getAppConfig();
    
    // Ensure default programs exist
    let newPrograms = [...loaded.programs];
    const hasEzImpo = newPrograms.find(p => p.programId === PROGRAM_IDS.EZIMPO);
    const hasEzPrintWork = newPrograms.find(p => p.programId === PROGRAM_IDS.EZPRINTWORK);

    if (!hasEzImpo) {
        newPrograms.push({
            id: 'ezimpo-default',
            programId: PROGRAM_IDS.EZIMPO,
            name: 'EzImpo 관리',
            sheetId: '',
            productName: 'EzImpo',
            downloadLink: ''
        });
    }

    const ezPrintWorkId = '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0';

    if (!hasEzPrintWork) {
        newPrograms.push({
            id: 'ezprintwork-default',
            programId: PROGRAM_IDS.EZPRINTWORK,
            name: 'EzPrintWork 관리',
            sheetId: ezPrintWorkId,
            productName: 'EzPrintWork',
            downloadLink: ''
        });
    } else {
        // If exists but empty, update it
        const idx = newPrograms.findIndex(p => p.programId === PROGRAM_IDS.EZPRINTWORK);
        if (idx !== -1 && !newPrograms[idx].sheetId) {
             newPrograms[idx] = { ...newPrograms[idx], sheetId: ezPrintWorkId };
        }
    }
    
    // Check if anything changed
    if (JSON.stringify(newPrograms) !== JSON.stringify(loaded.programs)) {
        loaded.programs = newPrograms;
        saveAppConfig(loaded);
    }

    setConfig(loaded);
  }, []);

  useEffect(() => {
    if(logBoxRef.current) {
        logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [diagLog]);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
      const time = new Date().toLocaleTimeString();
      let prefix = 'ℹ️';
      if(type === 'error') prefix = '❌';
      if(type === 'success') prefix = '✅';
      setDiagLog(prev => [...prev, `[${time}] ${prefix} ${msg}`]);
  };

  const handleUpdateProgram = (programId: PROGRAM_IDS, field: keyof ProgramConfig, value: string) => {
    const newPrograms = config.programs.map(p => 
        p.programId === programId ? { ...p, [field]: value } : p
    );
    setConfig({ ...config, programs: newPrograms });
  };

  const handleGlobalSave = () => {
    saveAppConfig(config);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  // Unused functions removed


  // --- Diagnosis Logic ---

  const validateKeyStep = async (): Promise<boolean> => {
    addLog("1단계: Private Key 형식 검사 중...");
    if (!config.privateKey) {
        addLog("오류: Private Key가 입력되지 않았습니다.", 'error');
        return false;
    }
    if (!config.clientEmail) {
        addLog("오류: Client Email이 입력되지 않았습니다.", 'error');
        return false;
    }

    if(!config.privateKey.includes("BEGIN PRIVATE KEY")) {
         addLog("⚠️ 경고: 키에 '-----BEGIN PRIVATE KEY-----' 헤더가 없습니다. 자동 복구를 시도합니다.", 'info');
    } else {
         addLog("Private Key 형식 확인됨.", 'success');
    }

    addLog(`2단계: 구글 인증 토큰 요청 중... (User: ${config.clientEmail})`);
    try {
        await getAccessToken(config.clientEmail, config.privateKey);
        addLog("✅ 인증 토큰 발급 성공! (계정 정보 유효함)", 'success');
        return true;
    } catch(e: any) {
        addLog(`❌ 토큰 발급 실패: ${e.message}`, 'error');
        addLog("힌트: PC 시간을 확인하거나, Private Key를 다시 복사해주세요.", 'info');
        return false;
    }
  };

  const handleTestCredentialsOnly = async () => {
      setDiagLog([]);
      addLog("=== 서비스 계정(Key) 유효성 검사 시작 ===");
      setTesting(true);
      await validateKeyStep();
      setTesting(false);
  };

  const handleTestConnection = async (sheetId: string) => {
    setDiagLog([]);
    addLog(`=== 전체 연결 진단 시작 (Sheet: ${sheetId}) ===`);

    if (!sheetId) {
      addLog("오류: 테스트할 시트 ID가 없습니다.", 'error');
      return;
    }

    const targetSheetId = cleanSheetId(sheetId);
    if (targetSheetId !== sheetId) {
        addLog(`알림: 입력된 URL에서 ID(${targetSheetId})만 추출하여 테스트합니다.`, 'info');
    }

    setTesting(true);

    try {
        const keyValid = await validateKeyStep();
        if (!keyValid) throw new Error("인증 실패로 인해 시트 접근을 시도하지 않습니다.");

        // 3. Sheet Access
        addLog(`3단계: 시트(${targetSheetId}) 접근 권한 확인 중...`);
        const result = await testConnection(targetSheetId, config.clientEmail, config.privateKey);
        
        if (result.success) {
            addLog(`시트 접근 성공! 제목: [${result.title}]`, 'success');
            
            // 4. Tab Sync
            addLog("4단계: 필수 탭(Products, Licenses 등) 확인 및 생성 중...");
            try {
                await initializeSheetTabs(targetSheetId, config.clientEmail, config.privateKey);
                addLog("모든 탭 동기화 완료.", 'success');
                addLog("🎉 연결 테스트 완전 성공! 저장 버튼을 누르세요.", 'success');
            } catch (e: any) {
                addLog(`탭 생성 중 경고: ${e.message}`, 'error');
            }

        } else {
           throw new Error(`${result.message}`);
        }
    } catch (e: any) {
        addLog(`❌ 진단 결과: 실패`, 'error');
        // addLog(`원인: ${e.message}`, 'error'); // 중복 출력 방지
        
        if (e.message.includes('권한') || e.message.includes('403')) {
            addLog(`💡 필수 조치: 구글 시트 우측 상단 [공유] 버튼을 누르고 '${config.clientEmail}' 을 '편집자'로 추가했는지 꼭 확인하세요.`, 'info');
        }
    } finally {
        setTesting(false);
    }
  };

  const handleSyncCustomers = async (programId: PROGRAM_IDS) => {
      if (!confirm('기존 라이선스 데이터를 분석하여 누락된 고객 정보를 Customers 시트에 자동으로 추가합니다. 진행하시겠습니까?')) return;
      setSyncingCustomers(true);
      setSyncResult(null);
      try {
          const result = await syncCustomersFromLicenses(programId);
          setSyncResult(`✅ 동기화 완료: 총 ${result.total}명의 고객 중 ${result.added}명이 새로 추가되었습니다.`);
      } catch (e: any) {
          setSyncResult(`❌ 동기화 실패: ${e.message}`);
      } finally {
          setSyncingCustomers(false);
      }
  };

  const handleImportEzPrintWorkData = async () => {
      if (!confirm("EzImpo 시트에서 EzPrintWork 관련 데이터를 찾아 현재 시트로 복사하시겠습니까?\n\n* 주의: 기존 데이터는 유지되며, 중복된 데이터가 생성될 수 있습니다.")) return;
      
      setSyncingCustomers(true); // 재사용
      try {
          // 1. Get EzImpo data
          const ezImpoLicenses = await getLicenses(true, PROGRAM_IDS.EZIMPO);
          
          // 2. Filter EzPrintWork data
          const ezPrintWorkLicenses = ezImpoLicenses.filter(l => 
              (l.productName && l.productName.toLowerCase().includes('ezprintwork')) ||
              (l.productId && l.productId.toLowerCase().includes('ezprintwork'))
          );
          
          if (ezPrintWorkLicenses.length === 0) {
              alert("EzImpo 시트에서 EzPrintWork 데이터를 찾을 수 없습니다.");
              return;
          }
          
          // 3. Save to EzPrintWork sheet
          await saveLicenses(ezPrintWorkLicenses, PROGRAM_IDS.EZPRINTWORK);
          
          alert(`${ezPrintWorkLicenses.length}개의 라이선스 데이터를 성공적으로 가져왔습니다.`);
      } catch (e: any) {
          console.error(e);
          alert("데이터 가져오기 실패: " + e.message);
      } finally {
          setSyncingCustomers(false);
      }
  };

  const handleTestGasConnection = async (programId: PROGRAM_IDS, url: string) => {
    if (!url) {
        addLog(`오류: [${programId}] GAS URL이 입력되지 않았습니다.`, 'error');
        return;
    }
    
    setGasTesting(prev => ({ ...prev, [programId]: true }));
    setGasTestResult(prev => ({ ...prev, [programId]: null }));
    addLog(`=== [${programId}] GAS 백엔드 연결 테스트 시작 ===`);
    addLog(`URL: ${url.substring(0, 50)}...`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({ action: 'ping', token: config.programs.find(p => p.programId === programId)?.securityToken || '' })
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const data = await response.json();
        addLog(`✅ GAS 응답 수신 성공!`, 'success');
        addLog(`응답 내용: ${JSON.stringify(data)}`);
        
        setGasTestResult(prev => ({ 
            ...prev, 
            [programId]: { success: true, message: '연결 성공!' } 
        }));
    } catch (e: any) {
        addLog(`❌ GAS 연결 실패: ${e.message}`, 'error');
        addLog(`💡 해결 방법: 1. GAS에서 '배포'를 '모든 사용자(Anyone)'로 했는지 확인 2. URL이 정확한지 확인`, 'info');
        setGasTestResult(prev => ({ 
            ...prev, 
            [programId]: { success: false, message: `실패: ${e.message}` } 
        }));
    } finally {
        setGasTesting(prev => ({ ...prev, [programId]: false }));
    }
  };
  
  const handleTestSolapiSms = async () => {
    if (!testSmsRecipient) {
        alert("테스트 수신 번호를 입력해 주세요.");
        return;
    }
    
    setSmsTesting(true);
    setTestSmsResult(null);
    addLog("=== 솔라피 SMS 테스트 발송 시작 ===");

    try {
        const { sendSmsViaSolapi } = await import('../services/smsService');
        addLog(`수신 번호: ${testSmsRecipient} 로 테스트 문자 전송 중...`);
        
        saveAppConfig(config); 
        
        const res = await sendSmsViaSolapi(testSmsRecipient, "[라이선스 플로우 매니저] 솔라피 문자 연동 테스트가 성공적으로 완료되었습니다!");
        if (res.success) {
            addLog("✅ 테스트 문자 전송 완전 성공!", 'success');
            setTestSmsResult({ success: true, message: "전송 성공! 휴대폰으로 전송된 문자를 확인해 보세요." });
        } else {
            throw new Error(res.message);
        }
    } catch (e: any) {
        addLog(`❌ 테스트 문자 전송 실패: ${e.message}`, 'error');
        setTestSmsResult({ success: false, message: `실패: ${e.message}` });
    } finally {
        setSmsTesting(false);
    }
  };

  // handleTestEmail removed

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in pb-12">
        <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">환경 설정</h1>
            <button
                onClick={handleGlobalSave}
                className={`px-6 py-2 rounded-lg font-bold text-white transition-all ${isSaved ? 'bg-green-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
                {isSaved ? <><i className="fas fa-check mr-2"></i>저장됨!</> : <><i className="fas fa-save mr-2"></i>전체 저장</>}
            </button>
        </div>

        {/* Section 1: Google Sheet Credentials */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-3">1. 구글 시트 연동 (Service Account)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client Email</label>
                    <input
                        type="text"
                        className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs"
                        value={config.clientEmail}
                        onChange={(e) => setConfig({ ...config, clientEmail: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Private Key</label>
                    <textarea
                        className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs h-24 resize-y"
                        value={config.privateKey}
                        onChange={(e) => setConfig({ ...config, privateKey: e.target.value })}
                    ></textarea>
                </div>
            </div>
        </div>

        {/* Section 2: Program Settings (Tabs) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex border-b">
                <button
                    className={`flex-1 py-4 text-center font-bold transition-colors ${activeTab === PROGRAM_IDS.EZIMPO ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
                    onClick={() => setActiveTab(PROGRAM_IDS.EZIMPO)}
                >
                    EzImpo 관리
                </button>
                <button
                    className={`flex-1 py-4 text-center font-bold transition-colors ${activeTab === PROGRAM_IDS.EZPRINTWORK ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
                    onClick={() => setActiveTab(PROGRAM_IDS.EZPRINTWORK)}
                >
                    EzPrintWork 관리
                </button>
            </div>

            <div className="p-6">
                {config.programs.map(program => {
                    if (program.programId !== activeTab) return null;
                    
                    return (
                        <div key={program.id} className="space-y-8 animate-fade-in">
                            {/* Sheet ID Settings */}
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <i className="fas fa-table text-green-600"></i> 구글 시트 설정
                                </h3>
                                <div className="bg-gray-50 p-5 rounded-lg border border-gray-200">
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Spreadsheet ID</label>
                                        <input
                                            type="text"
                                            className="w-full border border-gray-300 rounded-lg p-2 font-mono text-sm"
                                            placeholder="구글 시트 주소 또는 ID 입력"
                                            value={program.sheetId}
                                            onChange={(e) => handleUpdateProgram(program.programId, 'sheetId', e.target.value)}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            * 해당 프로그램({program.name})의 데이터가 저장될 시트 ID를 입력하세요.
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => handleTestConnection(program.sheetId)} 
                                        disabled={testing} 
                                        className="w-full bg-white border border-gray-300 text-gray-700 font-bold py-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                                    >
                                        {testing ? '연결 테스트 중...' : '연결 확인 및 탭 생성'}
                                    </button>
                                </div>
                            </div>

                            {/* Data Management & Tools */}
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <i className="fas fa-tools text-gray-600"></i> 데이터 관리 및 도구
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">다운로드 링크</label>
                                        <input
                                            type="text"
                                            placeholder="https://example.com/download"
                                            className="w-full border border-gray-300 rounded-lg p-2"
                                            value={program.downloadLink || ''}
                                            onChange={(e) => handleUpdateProgram(program.programId, 'downloadLink', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">GAS WebApp URL (백엔드 인증)</label>
                                        <input
                                            type="text"
                                            placeholder="https://script.google.com/macros/s/.../exec"
                                            className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs"
                                            value={program.gasUrl || ''}
                                            onChange={(e) => handleUpdateProgram(program.programId, 'gasUrl', e.target.value)}
                                        />
                                        <div className="flex items-center gap-2 mt-2">
                                            <button 
                                                onClick={() => handleTestGasConnection(program.programId, program.gasUrl || '')}
                                                disabled={gasTesting[program.programId]}
                                                className="flex-1 py-1 px-3 bg-white border border-gray-300 rounded text-[10px] font-bold hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {gasTesting[program.programId] ? '연결 확인 중...' : 'GAS 연결 테스트'}
                                            </button>
                                            {gasTestResult[program.programId] && (
                                                <span className={`text-[10px] font-bold ${gasTestResult[program.programId]?.success ? 'text-green-600' : 'text-red-600'}`}>
                                                    {gasTestResult[program.programId]?.message}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            * 프로그램별로 독립된 GAS 주소를 입력하여 안정성을 확보하세요.
                                        </p>
                                    </div>
                                    <div className="flex flex-col justify-end">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">고객 데이터 동기화</label>
                                        <button 
                                            onClick={() => handleSyncCustomers(program.programId)} 
                                            disabled={syncingCustomers}
                                            className="bg-orange-100 text-orange-700 font-bold py-2 px-4 rounded-lg hover:bg-orange-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            {syncingCustomers ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-sync-alt"></i>}
                                            기존 라이선스에서 고객 정보 추출하기
                                        </button>
                                        {program.programId === PROGRAM_IDS.EZPRINTWORK && (
                                            <button 
                                                onClick={handleImportEzPrintWorkData}
                                                disabled={syncingCustomers}
                                                className="mt-2 bg-blue-50 text-blue-700 font-bold py-2 px-4 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-xs"
                                            >
                                                <i className="fas fa-file-import"></i> EzImpo 시트에서 데이터 가져오기
                                            </button>
                                        )}
                                        {syncResult && <p className="text-[10px] mt-1 text-gray-600">{syncResult}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Diagnosis Log */}
        <div className="bg-slate-900 text-white rounded-lg p-4 shadow-lg">
            <h3 className="text-sm font-bold text-gray-400 mb-2 border-b border-gray-700 pb-2">진단 로그</h3>
            <div ref={logBoxRef} className="h-48 overflow-y-auto font-mono text-xs space-y-1">
                {diagLog.length === 0 ? <p className="text-gray-500 italic">로그가 없습니다.</p> : diagLog.map((log, i) => <p key={i} className="whitespace-pre-wrap">{log}</p>)}
            </div>
        </div>

        {/* Section 3: Google Contacts Sync (Renumbered) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 text-gray-100 text-9xl -mt-10 -mr-10 opacity-10 pointer-events-none">
                <i className="fas fa-address-book"></i>
             </div>
            <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
                3. 구글 주소록 연동 (Beta) 
                <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-bold">New</span>
            </h2>
            
            <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={config.enableContactSync || false} onChange={e => setConfig({...config, enableContactSync: e.target.checked})} className="sr-only peer" />
                        <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-indigo-600"></div>
                        <span className="ml-3 text-sm font-medium text-gray-900">구글 주소록 자동 동기화 사용</span>
                    </label>
                </div>

                {config.enableContactSync && (
                    <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 animate-fade-in">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            연동할 구글 계정 (Subject Email) 
                            <i className="fas fa-question-circle ml-2 text-gray-400 cursor-pointer hover:text-indigo-500" onClick={() => setShowSyncInfo(!showSyncInfo)}></i>
                        </label>
                        <input
                            type="text"
                            placeholder="ceo@mycompany.com (도메인 위임 사용 시)"
                            className="w-full border border-gray-300 rounded-lg p-3 text-sm"
                            value={config.googleSubjectEmail || ''}
                            onChange={(e) => setConfig({ ...config, googleSubjectEmail: e.target.value })}
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            * 라이선스 발급 시, 고객 정보를 위 이메일 계정의 구글 주소록에 자동으로 저장합니다.<br/>
                            * 비워둘 경우, 1번에서 설정한 'Service Account' 자체 주소록에 저장됩니다.
                        </p>
                        
                        {showSyncInfo && (
                            <div className="mt-4 p-4 bg-blue-50 text-blue-800 text-sm rounded border border-blue-200">
                                <h4 className="font-bold mb-2"><i className="fas fa-sync"></i> 휴대폰 동기화 원리</h4>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li><strong>Google Workspace(기업용) 계정 사용자:</strong> 위 칸에 본인 이메일을 입력하세요. 단, 관리자 콘솔에서 Service Account에 'Domain-Wide Delegation' 권한(https://www.googleapis.com/auth/contacts)을 부여해야 합니다.</li>
                                    <li><strong>일반 Gmail(@gmail.com) 사용자:</strong> 일반 계정은 보안상 위임(Impersonation)이 불가능합니다. 따라서 위 칸을 비워두세요. 연락처는 Service Account에 저장되며, 휴대폰과 직접 동기화되지는 않습니다. (API 호출은 성공하지만 폰에는 안 뜹니다)</li>
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        {/* Section 4: Solapi 문자 서비스 연동 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 text-gray-100 text-9xl -mt-10 -mr-10 opacity-10 pointer-events-none">
                <i className="fas fa-sms"></i>
             </div>
            <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-3 flex items-center gap-2">
                4. 솔라피(Solapi) 문자 서비스 연동 
                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-bold">SMS/LMS</span>
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">솔라피 API Key</label>
                    <input
                        type="text"
                        placeholder="NCSF..."
                        className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs"
                        value={config.solapiApiKey || ''}
                        onChange={(e) => setConfig({ ...config, solapiApiKey: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">솔라피 API Secret Key</label>
                    <input
                        type="password"
                        placeholder="솔라피 API Secret 입력"
                        className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs"
                        value={config.solapiApiSecret || ''}
                        onChange={(e) => setConfig({ ...config, solapiApiSecret: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">승인된 발신번호 (Sender Number)</label>
                    <input
                        type="text"
                        placeholder="010-0000-0000"
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                        value={config.solapiSenderNumber || ''}
                        onChange={(e) => setConfig({ ...config, solapiSenderNumber: e.target.value })}
                    />
                </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
                * 솔라피 콘솔에서 발급받은 API Key와 API Secret Key를 입력해 주세요.<br/>
                * 발신번호는 반드시 솔라피 홈페이지에 사전 등록 및 승인 완료된 번호여야 발송이 실패하지 않습니다.<br/>
                <strong className="text-indigo-600">* [영구 보존] 솔라피 설정 정보는 로컬 브라우저뿐만 아니라 구글 시트(Settings 탭)에 실시간으로 안전하게 자동 동기화 백업됩니다. 브라우저 캐시가 지워지거나 PC를 이동하더라도 자동으로 복원됩니다.</strong>
            </p>

            {/* 솔라피 테스트 발송 UI */}
            <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1">
                    <label className="block text-xs font-bold text-gray-500 mb-1">테스트 수신 번호</label>
                    <input
                        type="text"
                        placeholder="010-XXXX-XXXX"
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                        value={testSmsRecipient}
                        onChange={(e) => setTestSmsRecipient(e.target.value)}
                    />
                </div>
                <button
                    onClick={handleTestSolapiSms}
                    disabled={smsTesting}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                    {smsTesting ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
                    테스트 문자 발송
                </button>
            </div>
            {testSmsResult && (
                <p className={`text-xs font-bold mt-2 ${testSmsResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testSmsResult.message}
                </p>
            )}
        </div>
    </div>
  );
};

export default Settings;
