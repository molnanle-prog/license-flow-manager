
import React, { useState, useEffect, useMemo } from 'react';
import { getDebugLogs, getAllLicenses, getAllProducts, clearDebugLogs } from '../services/storageService';
import { compareVersions, extractInfoFromDebugLog } from '../services/versionService';
import { DebugLog, License, Product, PROGRAM_IDS } from '../types';

const COLUMN_DEFS = [
  { id: 'timestamp', label: '시간', width: 120 },
  { id: 'user', label: '사용자 / 업체', width: 160 },
  { id: 'version', label: '버전', width: 120 },
  { id: 'diagnosis', label: '분석 결과', width: 220 },
  { id: 'machineId', label: '기기 ID', width: 160 },
  { id: 'actions', label: '상세', width: 60 },
];

const DebugLogViewer: React.FC = () => {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [groupRedundant, setGroupRedundant] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{id: string, startX: number, startWidth: number} | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

  useEffect(() => {
    const defaults = COLUMN_DEFS.reduce((acc, col) => ({ ...acc, [col.id]: col.width }), {});
    const savedWidths = localStorage.getItem('DEBUG_LOG_COL_WIDTHS_V1');
    if (savedWidths) {
      try { setColWidths({ ...defaults, ...JSON.parse(savedWidths) }); } catch (e) { setColWidths(defaults); }
    } else {
      setColWidths(defaults);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(40, resizing.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizing.id]: newWidth }));
    };
    const handleMouseUp = () => {
      if (resizing) {
        localStorage.setItem('DEBUG_LOG_COL_WIDTHS_V1', JSON.stringify(colWidths));
        setResizing(null);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };
    if (resizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, colWidths]);

  const getDiagnosis = (log: DebugLog) => {
    try {
      if (!log.rawData) return { summary: log.action || "데이터 없음", risk: 'LOW', issues: [] };
      const data = JSON.parse(log.rawData);
      let summary = "";
      let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
      let issues: string[] = [];

      switch (log.action) {
        case 'verify':
          summary = "라이선스 인증 시도";
          if (!data.key) issues.push("라이선스 키 누락");
          if (!data.machineId) issues.push("기기 ID 누락");
          break;
        case 'checkStatusAndVersion':
          summary = "버전 및 상태 체크";
          break;
        case 'request_purchase':
          summary = "구매/발급 신청 접수";
          break;
        case 'log_startup':
          summary = "프로그램 실행 로그";
          break;
        default:
          summary = (log.action && log.action.length < 40 && !log.action.includes('{')) 
            ? log.action 
            : "상세 로그 확인 필요";
      }

      if (issues.length > 0) risk = 'HIGH';
      
      // 요약 메시지가 너무 길 경우를 대비해 자르기 (최대 50자)
      const finalSummary = summary.length > 50 ? summary.substring(0, 47) + '...' : summary;
      
      return { summary: finalSummary, risk, issues };
    } catch (e) {
      const fallbackSummary = (log.action && log.action.length < 30) ? log.action : "분석 오류";
      return { summary: fallbackSummary, risk: 'MEDIUM', issues: ["⚠️ 데이터 형식 오류"] };
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const [logData, licData, prodData] = await Promise.all([
        getDebugLogs(true),
        getAllLicenses(true),
        getAllProducts(true)
      ]);
      // Sort by timestamp desc
      logData.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLogs(logData);
      setLicenses(licData);
      setProducts(prodData);
    } catch (e) {
      console.error("Failed to fetch data for log viewer:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      setTimeout(() => setShowConfirm(false), 3000); // 3초 후 자동 취소
      return;
    }
    
    setShowConfirm(false);
    setIsClearing(true);

    try {
      // 1. 백그라운드에서 구글 시트 데이터 삭제
      await clearDebugLogs();
      console.log("Logs cleared successfully from Google Sheets.");
      
      // 2. 삭제 후 최신 상태로 갱신 (서버가 비워졌음을 확인)
      await fetchLogs();
    } catch (e) {
      console.error("Failed to clear logs:", e);
      alert('구글 시트 데이터 삭제 중 오류가 발생했습니다.');
    } finally {
      setIsClearing(false);
    }
  };

  const getUserInfo = (log: DebugLog) => {
    const mid = (log.machineId || '').trim().toLowerCase();
    
    // versionService의 공용 추출 함수 사용
    const info = extractInfoFromDebugLog(log);
    const payloadName = info.name;
    const payloadCompany = info.company;
    const payloadKey = info.key;
    const payloadVersion = info.version;
    const payloadProduct = info.product;

    const normalizeKey = (k: string) => (k || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // 2. Find matching license using COMPOUND KEY
    let matched = licenses.find(l => {
        const normalizedDBKey = normalizeKey(l.key);
        const normalizedPayloadKey = normalizeKey(payloadKey);
        
        const keyMatch = normalizedPayloadKey && normalizedDBKey === normalizedPayloadKey;
        const midMatch = mid && mid !== '-' && (l.machineId || '').trim().toLowerCase() === mid;
        
        if (payloadKey) return keyMatch;
        return midMatch;
    });

    const allWithSameMid = mid && mid !== '-' ? licenses.filter(l => (l.machineId || '').trim().toLowerCase() === mid) : [];
    const isCollision = allWithSameMid.length > 1;
    const isMismatch = matched && payloadName && matched.userName !== payloadName;

    return { 
        name: payloadName || matched?.userName || (mid && mid !== '-' ? '미등록 기기' : '-'), 
        company: payloadCompany || matched?.companyName || (mid && mid !== '-' ? '정보 없음' : '-'), 
        isGuest: !matched,
        mismatch: isMismatch ? matched.userName : null,
        collision: isCollision,
        collisionUsers: allWithSameMid.map(l => l.userName).filter(Boolean),
        payloadKey,
        payloadVersion,
        payloadProduct,
        matched,
        totalLicenses: licenses.length
    };
  };

  const filteredLogs = useMemo(() => {
    let base = logs.map(l => {
        const diagnosis = getDiagnosis(l);
        const user = getUserInfo(l);
        return { ...l, diagnosis, user };
    });
    
    // De-duplication (Grouping redundant logs)
    if (groupRedundant) {
        const grouped: any[] = [];
        base.forEach((log, idx) => {
            if (idx > 0) {
                const prev = base[idx-1];
                const isSameMachine = log.machineId === prev.machineId;
                const isSameAction = log.action === prev.action;
                const timeDiff = new Date(prev.timestamp).getTime() - new Date(log.timestamp).getTime();
                
                if (isSameMachine && isSameAction && timeDiff < 60000 && log.rawData === prev.rawData) {
                    if (grouped.length > 0) {
                        const last = grouped[grouped.length - 1];
                        last.repeatCount = (last.repeatCount || 1) + 1;
                        return;
                    }
                }
            }
            grouped.push({ ...log, repeatCount: 1 });
        });
        base = grouped;
    }

    const filtered = base.filter(log => {
      const s = searchTerm.toLowerCase();
      const matchesSearch = 
        (log.machineId || '').toLowerCase().includes(s) ||
        (log.user.name || '').toLowerCase().includes(s) ||
        (log.user.company || '').toLowerCase().includes(s) ||
        (log.rawData || '').toLowerCase().includes(s);
      const matchesAction = filterAction === 'all' || log.action === filterAction;
      const isIssue = log.diagnosis.risk === 'HIGH' || log.diagnosis.issues.length > 0;
      
      if (showIssuesOnly && !isIssue) return false;
      return matchesSearch && matchesAction;
    });

    if (sortConfig.key) {
        filtered.sort((a: any, b: any) => {
            let aVal = (a as any)[sortConfig.key];
            let bVal = (b as any)[sortConfig.key];
            
            // Nested object property handling
            if (sortConfig.key === 'user') aVal = a.user.name;
            if (sortConfig.key === 'user') bVal = b.user.name;
            if (sortConfig.key === 'diagnosis') aVal = a.diagnosis.summary;
            if (sortConfig.key === 'diagnosis') bVal = b.diagnosis.summary;

            if (!aVal) aVal = '';
            if (!bVal) bVal = '';
            
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }
    return filtered;
  }, [logs, searchTerm, filterAction, showIssuesOnly, groupRedundant, sortConfig, licenses, products]);

  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    logs.forEach(l => { if (l.action) actions.add(l.action); });
    return Array.from(actions);
  }, [logs]);

  const parseRawData = (raw: string) => {
    try {
      const cleanRaw = raw.trim().replace(/^['"]|['"]$/g, '');
      const parsed = JSON.parse(cleanRaw);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return raw;
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in p-4 bg-gray-50">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl py-4 px-6 text-white shadow-xl">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-3">
              <i className="fas fa-terminal text-blue-400"></i> 시스템 디버그 로그
            </h2>
            <p className="text-slate-400 text-xs mt-1">서버(GAS)로 들어오는 모든 요청의 실시간 기록입니다.</p>
          </div>
          <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={handleClearLogs}
            disabled={isClearing || isLoading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-xs font-bold border shadow-sm relative z-10 cursor-pointer ${
              showConfirm 
                ? 'bg-rose-600 text-white border-rose-700 animate-pulse' 
                : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'
            } disabled:opacity-50`}
          >
            {isClearing ? (
              <i className="fas fa-circle-notch fa-spin"></i>
            ) : (
              <i className={`fas ${showConfirm ? 'fa-exclamation-triangle' : 'fa-trash-alt'}`}></i>
            )}
            {isClearing ? '삭제 중...' : (showConfirm ? '진짜 삭제할까요?' : '로그 초기화')}
          </button>
          <button 
            type="button"
            onClick={() => fetchLogs()}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-all text-xs font-bold shadow-sm disabled:opacity-50 relative z-10 cursor-pointer"
          >
            <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
            새로고침
          </button>
        </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col min-h-0 overflow-hidden flex-1">
        <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input 
              type="text" 
              placeholder="기기 ID 또는 데이터 검색..." 
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4 shrink-0">
             <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-10 h-5 rounded-full transition-colors relative ${showIssuesOnly ? 'bg-red-500' : 'bg-gray-300'}`}>
                    <input type="checkbox" className="hidden" checked={showIssuesOnly} onChange={e => setShowIssuesOnly(e.target.checked)} />
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${showIssuesOnly ? 'translate-x-5' : 'translate-x-1'}`}></div>
                </div>
                <span className="text-xs font-bold text-gray-600">문제 내역만 보기</span>
             </label>
             <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-10 h-5 rounded-full transition-colors relative ${groupRedundant ? 'bg-blue-500' : 'bg-gray-300'}`}>
                    <input type="checkbox" className="hidden" checked={groupRedundant} onChange={e => setGroupRedundant(e.target.checked)} />
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${groupRedundant ? 'translate-x-5' : 'translate-x-1'}`}></div>
                </div>
                <span className="text-xs font-bold text-gray-600">중복 묶기</span>
             </label>
          </div>
          <select 
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
          >
            <option value="all">모든 액션</option>
            {uniqueActions.map(action => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-auto bg-white">
          <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {COLUMN_DEFS.map(col => (
                <col key={col.id} style={{ width: colWidths[col.id] || col.width }} />
              ))}
            </colgroup>
            <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider sticky top-0 z-10 shadow-sm">
              <tr>
                {COLUMN_DEFS.map(col => (
                  <th 
                    key={col.id} 
                    className={`px-4 py-3 font-bold relative group border-r border-gray-200/50 last:border-r-0 text-center cursor-pointer hover:bg-gray-100 transition-colors ${sortConfig.key === col.id ? 'bg-blue-50/50 text-blue-700' : ''}`}
                    onClick={() => {
                        if (col.id === 'actions') return;
                        const direction = sortConfig.key === col.id && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: col.id, direction });
                    }}
                  >
                    <div className="flex items-center gap-1 justify-center">
                      {col.label}
                      {sortConfig.key === col.id && (
                        <i className={`fas fa-sort-amount-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[8px]`}></i>
                      )}
                    </div>
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-300 group-hover:bg-gray-300 transition-colors" 
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setResizing({ id: col.id, startX: e.clientX, startWidth: colWidths[col.id] || col.width });
                        e.preventDefault();
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={COLUMN_DEFS.length} className="px-6 py-12 text-center text-gray-400">
                    <i className="fas fa-circle-notch fa-spin text-2xl mb-2 text-blue-500"></i>
                    <p>로그 데이터를 불러오는 중...</p>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_DEFS.length} className="px-6 py-12 text-center text-gray-400">로그 내역이 없습니다.</td>
                </tr>
              ) : (
                filteredLogs.map((log: any, idx) => (
                  <React.Fragment key={idx}>
                    <tr 
                      className={`hover:bg-blue-50/30 transition-colors cursor-pointer ${expandedLog === `log-${idx}` ? 'bg-blue-50' : ''}`}
                      onClick={() => setExpandedLog(expandedLog === `log-${idx}` ? null : `log-${idx}`)}
                    >
                      <td className="px-4 py-1.5 whitespace-nowrap text-[10px] text-gray-400 font-mono border-r border-gray-100/50 text-center">
                        <div className="flex flex-col leading-tight items-center">
                            <span>{new Date(log.timestamp).toLocaleDateString('ko-KR').slice(5)}</span>
                            <span className="text-gray-600 font-bold">{new Date(log.timestamp).toLocaleTimeString('ko-KR', {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                        </div>
                        {log.repeatCount > 1 && <div className="mt-0.5 text-blue-500 font-bold text-[9px]">+{log.repeatCount-1}회 반복</div>}
                      </td>
                      <td className="px-4 py-1.5 border-r border-gray-100/50 text-center">
                        <div className="flex flex-col leading-tight truncate items-center">
                          <div className="flex items-center gap-1 flex-wrap justify-center">
                            <span className={`text-xs font-bold truncate ${log.user.isGuest ? 'text-gray-400' : 'text-indigo-600'}`}>
                                {log.user.name}
                            </span>
                            
                            {/* Status Badges */}
                            {!log.user.collision && !log.user.mismatch && !log.user.isGuest ? (
                                <span className="text-[8px] bg-green-50 text-green-600 px-1 rounded-sm font-bold border border-green-100">
                                    정상
                                </span>
                            ) : (
                                <div className="flex gap-0.5">
                                    {log.user.collision && (
                                        <span className="text-[8px] bg-amber-50 text-amber-600 px-1 rounded-sm font-bold border border-amber-100">
                                            기기중복
                                        </span>
                                    )}
                                    {log.user.mismatch && (
                                        <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded-sm font-bold border border-slate-200">
                                            이름다름(단순정보)
                                        </span>
                                    )}
                                    {log.user.isGuest && (
                                        <span className="text-[8px] bg-gray-100 text-gray-500 px-1 rounded-sm font-bold border border-gray-200">
                                            미등록
                                        </span>
                                    )}
                                </div>
                            )}
                          </div>
                          {log.user.mismatch && (
                             <span className="text-[8px] text-slate-400 font-medium" title={`등록명: ${log.user.mismatch}`}>
                                (DB: {log.user.mismatch})
                             </span>
                          )}
                          <span className="text-[9px] text-gray-400 font-medium truncate">{log.user.company}</span>
                        </div>
                      </td>
                      <td className="px-4 py-1.5 border-r border-gray-100/50 text-center">
                        {(() => {
                            const extractedVer = log.user.payloadVersion;
                            const sheetVer = (log.version && log.version !== 'OK' && !log.version.includes('ERROR')) ? log.version : '';
                            
                            // [FIX] 추출된 버전(payloadVersion)이 있다면 그것을 최우선으로 사용
                            let currentVer = (extractedVer && extractedVer !== 'OK') ? extractedVer : (sheetVer || 'v?');
                            
                            if (currentVer !== 'v?' && !currentVer.startsWith('v') && /^\d/.test(currentVer)) {
                                currentVer = `v${currentVer}`;
                            }

                            const lic = log.user.matched;
                            if (!lic) return (
                                <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border border-gray-200">
                                    <i className="fas fa-code-branch text-[8px]"></i>
                                    {currentVer}
                                </span>
                            );
                            
                            const prod = products.find(p => p.id === lic.productId);
                            const targetVersion = prod?.version || lic.version || '3.6.9';
                            
                            const cmp = compareVersions(currentVer, targetVersion);
                            return (
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-sm border shadow-sm ${cmp >= 0 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-rose-100 text-rose-700 border-rose-200'}`}>
                                        <i className={`fas ${cmp >= 0 ? 'fa-check' : 'fa-arrow-up'} text-[8px]`}></i>
                                        {currentVer}
                                    </span>
                                    {cmp >= 0 ? (
                                        <span className="text-[8px] text-green-600 font-bold uppercase tracking-tighter">Latest Version</span>
                                    ) : (
                                        <span className="text-[8px] text-amber-500 font-bold uppercase tracking-tighter">Update Needed</span>
                                    )}
                                </div>
                            );
                        })()}
                      </td>
                      <td className="px-4 py-1.5 border-r border-gray-100/50 text-center overflow-hidden" style={{ maxWidth: colWidths.diagnosis || 220 }}>
                        <div className="flex flex-col gap-0.5 leading-tight items-center w-full overflow-hidden">
                          <div className="flex items-center gap-1 max-w-full overflow-hidden justify-center">
                             {log.user.payloadProduct && (
                                 <span className="shrink-0 text-[9px] bg-slate-100 text-slate-600 px-1 rounded font-bold border border-slate-200 uppercase">
                                     {log.user.payloadProduct}
                                 </span>
                             )}
                             <span className="text-xs font-bold text-gray-800 truncate block max-w-full" title={log.diagnosis.summary}>
                                {log.diagnosis.summary}
                             </span>
                          </div>
                          <div className="flex flex-wrap gap-1 justify-center max-w-full overflow-hidden">
                             <span className={`text-[9px] font-mono px-1 rounded border truncate max-w-[100px] ${
                                log.action === 'verify' ? 'text-blue-500 bg-blue-50 border-blue-100' : 'text-gray-400 bg-gray-50 border-gray-100'
                             }`} title={log.action}>{log.action}</span>
                             {log.diagnosis.issues.map((issue: string) => (
                               <span key={issue} className="bg-red-50 text-red-600 text-[9px] px-1 py-0.2 rounded font-bold border border-red-100 whitespace-nowrap shrink-0">
                                 {issue}
                               </span>
                             ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-1.5 border-r border-gray-100/50">
                        <div className="text-[10px] font-mono text-gray-500 break-all">{log.machineId}</div>
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        <i className={`fas fa-chevron-${expandedLog === `log-${idx}` ? 'up' : 'down'} text-gray-300 text-[10px]`}></i>
                      </td>
                    </tr>
                    {expandedLog === `log-${idx}` && (
                      <tr>
                        <td colSpan={COLUMN_DEFS.length} className="px-6 py-4 bg-slate-50 border-y border-gray-100">
                          <div className="bg-white rounded-2xl w-full border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                            {/* Diagnosis Header */}
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                                  <i className="fas fa-microchip text-sm"></i>
                                </div>
                                <div>
                                  <h3 className="text-sm font-bold text-gray-900">로그 상세 분석 결과</h3>
                                  <p className="text-[10px] text-gray-500">시스템이 자동으로 분석한 데이터 무결성 리포트입니다.</p>
                                </div>
                              </div>
                            </div>

                            <div className="p-5 space-y-6">
                              {/* Diagnosis Section */}
                              <div className="space-y-3">
                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                  <i className="fas fa-stethoscope"></i> 시스템 진단 정보 
                                  <span className="ml-auto normal-case font-normal">(현재 로드된 라이선스: {log.user.totalLicenses}개)</span>
                                </h4>
                                <div className="grid grid-cols-1 gap-2">
                                  <div className="p-3 bg-green-50 border border-green-100 rounded-xl">
                                    <div className="flex items-center gap-2 text-green-700 font-bold text-xs">
                                      <i className="fas fa-check-circle"></i> 데이터 구조 분석 완료
                                    </div>
                                  </div>

                                  {log.user.collision && (
                                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                                      <div className="flex items-center gap-2 text-amber-700 font-bold text-xs mb-1">
                                        <i className="fas fa-copy"></i> 기기 ID 중복 사용 감지
                                      </div>
                                      <p className="text-[11px] text-amber-600 leading-relaxed">
                                        이 기기 번호({log.machineId})는 다음 사용자들과 연결되어 있습니다:
                                        <span className="font-bold ml-1">{log.user.collisionUsers.join(', ')}</span>
                                        <br />저가형 메인보드나 가상 머신 환경에서 발생하는 흔한 문제입니다.
                                      </p>
                                    </div>
                                  )}

                                  {log.user.mismatch && (
                                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                      <div className="flex items-center gap-2 text-slate-600 font-bold text-xs mb-1">
                                        <i className="fas fa-info-circle"></i> PC 환경 이름 차이 (참고사항)
                                      </div>
                                      <p className="text-[11px] text-slate-500 leading-relaxed">
                                        라이선스는 <span className="font-bold">[{log.user.mismatch}]</span>님으로 등록되어 있으나,
                                        현재 접속한 PC의 윈도우/프로그램 계정명은 <span className="font-bold">[{log.user.name}]</span>(으)로 설정되어 있습니다.
                                        <br /><span className="text-[10px] opacity-70">* 대부분의 PC는 'Administrator'나 'User'로 되어 있으므로 자연스러운 현상입니다. 라이선스 정상 사용에 문제가 없습니다.</span>
                                      </p>
                                    </div>
                                  )}

                                  {/* Version Analysis Card */}
                                  {(() => {
                                      const extractedVer = log.user.payloadVersion;
                                      const sheetVer = (log.version && log.version !== 'OK' && !log.version.includes('ERROR')) ? log.version : '';
                                      const currentVer = (extractedVer && extractedVer !== 'OK') ? extractedVer : (sheetVer || 'v?');
                                      
                                      const lic = log.user.matched;
                                      if (!lic) return null;
                                      const prod = products.find(p => p.id === lic.productId);
                                      const targetVersion = prod?.version || lic.version || '3.6.9';
                                      const cmp = compareVersions(currentVer, targetVersion);
                                      const isLogVersionHigher = currentVer !== 'v?' && targetVersion !== '?' && compareVersions(currentVer, targetVersion) > 0;
                                      
                                      const handleUpdateProductVersion = async () => {
                                          if (!prod) return;
                                          if (!window.confirm(`제품(${prod.name})의 오피셜 버전을 현재 로그 버전(${currentVer})으로 업데이트하시겠습니까?\n이 작업은 구글 시트에 즉시 반영됩니다.`)) return;
                                          
                                          try {
                                              setIsLoading(true);
                                              const { saveProduct } = await import('../services/storageService');
                                              await saveProduct({ ...prod, version: currentVer.replace(/^v/, '') }, prod.programId as any);
                                              alert('제품 버전이 성공적으로 업데이트되었습니다.');
                                              await fetchLogs();
                                          } catch (e: any) {
                                              alert('업데이트 실패: ' + e.message);
                                          } finally {
                                              setIsLoading(false);
                                          }
                                      };
                                      
                                      return (
                                        <div className={`p-3 rounded-xl border ${cmp >= 0 ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
                                          <div className={`flex items-center gap-2 font-bold text-xs mb-1 ${cmp >= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                                            <i className={`fas ${cmp >= 0 ? 'fa-check-double' : 'fa-info-circle'}`}></i> 프로그램 버전 진단: {cmp >= 0 ? '최신' : '구형'}
                                          </div>
                                          <div className="flex items-center gap-4 mt-2">
                                            <div>
                                              <p className="text-[9px] text-gray-500 uppercase">현재 구동 버전</p>
                                              <p className={`text-sm font-mono font-bold ${cmp >= 0 ? 'text-green-600' : 'text-amber-600'}`}>{currentVer}</p>
                                            </div>
                                            <i className="fas fa-arrow-right text-gray-300"></i>
                                            <div>
                                              <p className="text-[9px] text-gray-500 uppercase">제품 등록 버전 (최신)</p>
                                              <div className="flex items-center gap-2">
                                                <p className="text-sm font-mono font-bold text-gray-700">{targetVersion}</p>
                                                {isLogVersionHigher && (
                                                    <button 
                                                        onClick={handleUpdateProductVersion}
                                                        className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded hover:bg-blue-600 transition-colors flex items-center gap-1 shadow-sm"
                                                        title="로그 버전으로 제품 정보 업데이트"
                                                    >
                                                        <i className="fas fa-sync-alt text-[8px]"></i>
                                                        제품버전 갱신
                                                    </button>
                                                )}
                                              </div>
                                            </div>
                                            {cmp < 0 && (
                                                <div className="ml-auto">
                                                    <span className="bg-amber-500 text-white text-[10px] px-2 py-1 rounded font-bold animate-pulse shadow-sm">업데이트 필요</span>
                                                </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                  })()}
                                </div>
                              </div>

                              {/* Raw Data Section */}
                              <div className="space-y-3">
                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                  <i className="fas fa-code"></i> 원본 데이터 로그 (Raw JSON)
                                </h4>
                                <div className="relative group">
                                  <pre className="p-4 bg-gray-900 text-gray-300 rounded-xl text-[11px] font-mono overflow-auto leading-relaxed max-h-[300px]">
                                    {parseRawData(log.rawData)}
                                  </pre>
                                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[9px] bg-white/10 text-white/50 px-2 py-1 rounded">Read Only</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedLog(null);
                                }}
                                className="px-4 py-1.5 bg-gray-900 text-white text-[10px] font-bold rounded-lg hover:bg-gray-800 transition-all"
                              >
                                닫기
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DebugLogViewer;
