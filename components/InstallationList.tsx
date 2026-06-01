
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, doc, setDoc, query } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../services/firebaseUtils';
import { Installation, License, Product } from '../types';
import { getInstallations, saveInstallations, getLicenses, getProducts, getCurrentProgram } from '../services/storageService';
import { compareVersions } from '../services/versionService';

// Define the combined data type for the view
interface InstallationRecord extends Installation {
  status: 'ACTIVATED' | 'PENDING' | 'TRIAL';
  licenseKey?: string;
  matchedLicense?: License; 
  matchedProduct?: Product; 
  extractedContact?: string; 
  alias?: string;
}

// [NEW] Column Definitions for InstallLogs
const COLUMN_DEFS = [
  { id: 'timestamp', label: '최근 실행', width: 130 },
  { id: 'companyName', label: '상호명', width: 140 },
  { id: 'userName', label: '사용자', width: 100 },
  { id: 'contact', label: '연락처', width: 120 },
  { id: 'machineId', label: '기기 ID', width: 180 },
  { id: 'actionType', label: '유형', width: 90 },
  { id: 'result', label: '결과', width: 100 },
  { id: 'ip', label: 'IP', width: 100 },
  { id: 'version', label: '버전', width: 70 },
  { id: 'productName', label: '제품명', width: 130 },
  { id: 'actions', label: '관리', width: 70 },
];

// Robust Korean date parser to handle 2-digit and 4-digit years
const parseSafeDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    let s = dateStr.trim();
    
    // Replace Korean markers with standard ones
    s = s.replace(/오전/g, 'AM').replace(/오후/g, 'PM');
    
    // Check for 2-digit year like "26. 5. 11."
    const shortYearMatch = s.match(/^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
    if (shortYearMatch) {
        const year = 2000 + parseInt(shortYearMatch[1]);
        const month = parseInt(shortYearMatch[2]);
        const day = parseInt(shortYearMatch[3]);
        const rest = s.split('.').slice(3).join('.').trim();
        s = `${year}-${month}-${day} ${rest}`;
    }
    
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
};

// Helper to extract phone from name string
const extractPhoneFromName = (name: string): { name: string, contact: string | null } => {
    if (!name) return { name: '', contact: null };
    let rawName = name;
    let contact: string | null = null;
    const phoneRegex = /(01[016789][-\s.]?\d{3,4}[-\s.]?\d{4})/g;
    const phoneMatch = rawName.match(phoneRegex);
    if (phoneMatch && phoneMatch.length > 0) {
        contact = phoneMatch[0].replace(/[\s.]/g, '-');
        if (!contact.includes('-') && contact.length === 11) {
              contact = contact.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
        }
    }
    let cleanName = rawName.replace(/[(\[]?\s*01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\s*[)\]]?/g, '');
    cleanName = cleanName.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').trim();
    if (contact) {
          cleanName = cleanName.replace(contact, '').replace(contact.replace(/-/g,''), '').trim();
    }
    return { name: cleanName, contact };
};

const InstallLogs: React.FC = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<InstallationRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'ACTIVATED' | 'TRIAL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [cleanupCount, setCleanupCount] = useState<number>(0);

  // [NEW] Resizing State
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{id: string, startX: number, startWidth: number} | null>(null);
  const [deviceAliases, setDeviceAliases] = useState<Record<string, string>>({});
  const [editingAlias, setEditingAlias] = useState<{deviceId: string, currentAlias: string} | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

  const currentProgram = getCurrentProgram();

  // Load Device Aliases from Firestore
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupListener = () => {
      // [BYPASS] allow reading device aliases without Auth
      // if (!auth.currentUser) return;

      const q = query(collection(db, 'device_aliases'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const aliases: Record<string, string> = {};
        snapshot.forEach((doc) => {
          aliases[doc.id] = doc.data().alias;
        });
        setDeviceAliases(aliases);
      }, (error) => {
        // Handle permission denied or other errors
        if (error.code === 'permission-denied') {
          console.warn("Firestore permission denied for device_aliases. User might not be an admin or session expired.");
        }
        try {
          handleFirestoreError(error, OperationType.LIST, 'device_aliases');
        } catch (e) {
          // Error is thrown as JSON string, we can catch it here if we don't want it to crash the app
          console.error("Caught expected firestore error:", e);
        }
      });
    };

    // Initial setup
    setupListener();

    // Re-setup if auth state changes
    const authUnsubscribe = auth.onAuthStateChanged(() => {
      if (unsubscribe) unsubscribe();
      setupListener();
    });

    return () => {
      if (unsubscribe) unsubscribe();
      authUnsubscribe();
    };
  }, []);

  useEffect(() => {
    // Load saved widths
    const savedWidths = localStorage.getItem('INSTALL_LOG_COL_WIDTHS_V1');
    const defaults = COLUMN_DEFS.reduce((acc, col) => ({ ...acc, [col.id]: col.width }), {});
    if (savedWidths) {
      try {
        setColWidths({ ...defaults, ...JSON.parse(savedWidths) });
      } catch (e) {
        setColWidths(defaults);
      }
    } else {
      setColWidths(defaults);
    }
    
    loadData(false, true); 
  }, [currentProgram?.id]); 

  // [NEW] Mouse Move Listener for Resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(40, resizing.startWidth + diff); 
      setColWidths(prev => ({ ...prev, [resizing.id]: newWidth }));
    };
    const handleMouseUp = () => {
      if (resizing) {
        localStorage.setItem('INSTALL_LOG_COL_WIDTHS_V1', JSON.stringify(colWidths));
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

  useEffect(() => {
      if (cleanupCount > 0) {
          const timer = setTimeout(() => setCleanupCount(0), 4000);
          return () => clearTimeout(timer);
      }
  }, [cleanupCount]);

  // [NEW] Global Refresh Event Listener
  useEffect(() => {
    const handleGlobalRefresh = () => {
        loadData(true, false);
    };
    window.addEventListener('REFRESH_DATA', handleGlobalRefresh);
    return () => window.removeEventListener('REFRESH_DATA', handleGlobalRefresh);
  }, [currentProgram?.id]);

  const normalize = (s?: string) => (s || '').trim().toLowerCase();

  const loadData = async (forceRefresh = false, autoCleanup = false): Promise<number | null> => {
    setLoading(true);
    let removedCount: number | null = null;

    const timeout = setTimeout(() => {
        setLoading(false);
    }, 30000);

    try {
      const [rawInstallations, licenses, prods] = await Promise.all([
          getInstallations(forceRefresh, currentProgram?.programId), 
          getLicenses(forceRefresh, currentProgram?.programId),
          getProducts(forceRefresh, currentProgram?.programId)
      ]);
      clearTimeout(timeout);

      // [HOTFIX] 구글 시트 백엔드 스크립트의 열 밀림 현상 보정 
      // (ip 컬럼에 제품명이 저장되고, productName이 비어버리는 증상 해결)
      const installations = rawInstallations.map(inst => {
          let correctedProductName = inst.productName;
          let correctedIp = inst.ip;
          if (inst.ip && (inst.ip.toLowerCase().includes('ezimpo') || inst.ip.toLowerCase().includes('printwork') || inst.ip.toLowerCase().includes('임포'))) {
              correctedProductName = inst.ip;
              correctedIp = '';
          }
          return { ...inst, productName: correctedProductName, ip: correctedIp };
      });
      setProducts(prods);
      const licenseMap = new Map<string, License>();
      licenses.forEach(lic => {
        if (lic.machineId && lic.contactInfo) {
          const key = `${normalize(lic.machineId)}|${normalize(lic.contactInfo)}`;
          licenseMap.set(key, lic);
        }
      });
      const sortedInst = [...installations].sort((a, b) => {
          const timeA = parseSafeDate(a.timestamp || '')?.getTime() || 0;
          const timeB = parseSafeDate(b.timestamp || '')?.getTime() || 0;
          return (timeB || 0) - (timeA || 0);
      });

      // [NEW] Create a map of machineId -> contact from all installations and licenses
      const machineContactMap = new Map<string, string>();
      installations.forEach(inst => {
          if (inst.machineId && inst.contact) {
              machineContactMap.set(normalize(inst.machineId), inst.contact);
          }
      });
      licenses.forEach(lic => {
          if (lic.machineId && lic.contactInfo) {
              machineContactMap.set(normalize(lic.machineId), lic.contactInfo);
          }
      });

      let displayRecords: InstallationRecord[] = sortedInst.map((inst): InstallationRecord => {
        const contact = inst.contact || machineContactMap.get(normalize(inst.machineId)) || '';
        const key = `${normalize(inst.machineId)}|${normalize(contact)}`;
        let matchedLicense = licenseMap.get(key);
        
        const logProductName = normalize(inst.productName);
        const matchedProd = prods.find(p => normalize(p.name) === logProductName);

        // [NEW] Fallback: if not found by machineId|contact, try machineId + productId
        if (!matchedLicense && matchedProd) {
            matchedLicense = licenses.find(lic => 
                normalize(lic.machineId) === normalize(inst.machineId) && 
                lic.productId === matchedProd.id
            );
        }
        
        let status: 'ACTIVATED' | 'PENDING' | 'TRIAL' = 'PENDING';
        if (matchedLicense) {
            status = 'ACTIVATED';
        } else if (inst.actionType === 'TRIAL_ACTIVATED' || inst.result?.includes('체험판')) {
            status = 'TRIAL';
        }
        const { name: cleanName, contact: extractedContact } = extractPhoneFromName(inst.userName || '');
        
        return {
          ...inst,
          contact: contact || extractedContact || matchedLicense?.contactInfo || undefined,
          userName: matchedLicense?.userName || cleanName || inst.userName,
          companyName: matchedLicense?.companyName || inst.companyName,
          extractedContact: extractedContact || undefined,
          status: status,
          licenseKey: matchedLicense?.key,
          matchedLicense: matchedLicense,
          matchedProduct: matchedProd,
          alias: deviceAliases[inst.machineId || '']
        };
      });
      if (autoCleanup) {
          const uniqueRecords: InstallationRecord[] = [];
          const seenMachineKeys = new Set<string>();
          const seenUserKeys = new Set<string>();
          let duplicateCount = 0;
          for (const record of displayRecords) {
              const machineKey = record.machineId ? `${normalize(record.machineId)}|${normalize(record.productName)}` : null;
              
              // [SMART MATCH] 이름이 달라도 연락처와 제품명이 같다면 동일 사용자로 간주
              const userKey = (record.contact && normalize(record.contact).length > 5)
                  ? `${normalize(record.contact)}|${normalize(record.productName)}`
                  : null;

              if ((machineKey && seenMachineKeys.has(machineKey)) || (userKey && seenUserKeys.has(userKey))) {
                  duplicateCount++;
              } else {
                  if (machineKey) seenMachineKeys.add(machineKey);
                  if (userKey) seenUserKeys.add(userKey);
                  uniqueRecords.push(record);
              }
          }
          if (duplicateCount > 0) {
              // [FIX] Installation 인터페이스에 맞는 필드만 정확히 추출 (alias 등 방해 요소 제거)
              const cleanInstallations: Installation[] = uniqueRecords.map(r => ({
                  id: r.id,
                  timestamp: r.timestamp,
                  productName: r.productName,
                  companyName: r.companyName,
                  userName: r.userName,
                  contact: r.contact,
                  machineId: r.machineId,
                  actionType: r.actionType,
                  result: r.result,
                  ip: r.ip,
                  version: r.version
              }));
              await saveInstallations(cleanInstallations, currentProgram?.programId);
              setCleanupCount(duplicateCount);
              displayRecords = uniqueRecords; 
              removedCount = duplicateCount;
          } else {
              removedCount = 0;
          }
      }
      setRecords(displayRecords);
    } catch (error) {
      console.error("Error loading installation data:", error);
    } finally {
      setLoading(false);
    }
    return removedCount;
  };

  const handleManualCleanup = async () => {
    if (!confirm("정말로 중복 로그를 정리하시겠습니까?\n(동일 연락처/기기 기반 최신 로그만 남기고 과거 기록은 영구 삭제됩니다)")) return;
    
    setIsCleaning(true);
    try {
        const count = await loadData(true, true);
        if (count !== null && count > 0) {
            alert(`정리 완료! ${count}개의 중복 항목을 삭제했습니다.`);
        } else {
            alert("정리할 중복 항목이 없습니다.");
        }
    } catch (e: any) {
        alert("정리 중 오류가 발생했습니다:\n" + (e.message || "알 수 없는 오류"));
    } finally {
        setIsCleaning(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString('ko-KR', {
            year: '2-digit', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
  };

  const handleIssueLicense = (record: InstallationRecord) => {
    if (record.status === 'ACTIVATED') {
        alert("이미 정품 인증이 완료된 기기입니다.");
        return;
    }
    const transferData = {
        machineId: record.machineId,
        targetProductId: record.matchedProduct ? record.matchedProduct.id : '',
        originalProductName: record.productName,
        userName: record.userName || '설치된 기기 사용자',
        companyName: record.companyName || '',
        contact: record.contact || record.extractedContact || '' 
    };
    if(confirm(`[${record.productName}] 제품에 대한 라이선스를 생성하시겠습니까?\nMachine ID가 자동으로 입력됩니다.`)) {
        navigate('/', { state: { autoCreate: transferData } });
    }
  };

  const handleSaveAlias = async (deviceId: string, alias: string) => {
    // [BYPASS] allow saving device aliases without Auth
    try {
      await setDoc(doc(db, 'device_aliases', deviceId), {
        deviceId,
        alias,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setEditingAlias(null);
    } catch (error) {
      console.error("Error saving alias:", error);
      alert("별칭 저장 중 오류가 발생했습니다.");
    }
  };

  const sortedRecords = React.useMemo(() => {
    let items = [...records];
    if (filter !== 'ALL') {
      items = items.filter(r => r.status === filter);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(r => {
        const companyName = (r.companyName || '').toLowerCase();
        const userName = (r.userName || '').toLowerCase();
        const contact = (r.contact || '').toLowerCase();
        const extractedContact = (r.extractedContact || '').toLowerCase();
        const machineId = (r.machineId || '').toLowerCase();
        const productName = (r.productName || '').toLowerCase();
        const version = (r.version || '').toLowerCase();
        const ip = (r.ip || '').toLowerCase();
        const alias = (r.alias || '').toLowerCase();
        const actionType = (r.actionType || '').toLowerCase();
        const result = (r.result || '').toLowerCase();
        const matchedLicenseName = (r.matchedLicense?.userName || '').toLowerCase();
        const matchedLicenseCompany = (r.matchedLicense?.companyName || '').toLowerCase();

        return companyName.includes(q) ||
               userName.includes(q) ||
               contact.includes(q) ||
               extractedContact.includes(q) ||
               machineId.includes(q) ||
               productName.includes(q) ||
               version.includes(q) ||
               ip.includes(q) ||
               alias.includes(q) ||
               actionType.includes(q) ||
               result.includes(q) ||
               matchedLicenseName.includes(q) ||
               matchedLicenseCompany.includes(q);
      });
    }
    
    if (sortConfig.key) {
      items.sort((a, b) => {
        const aVal = (a as any)[sortConfig.key] || '';
        const bVal = (b as any)[sortConfig.key] || '';
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [records, filter, searchQuery, sortConfig]);

  const handleStandardize = async () => {
    if (!confirm("모든 로그의 날짜와 형식을 표준 규격으로 통일하시겠습니까?\n이 작업은 시트의 원본 데이터를 수정합니다.")) return;
    
    setIsCleaning(true);
    try {
        const standardRecords = records.map(r => {
            const date = parseSafeDate(r.timestamp || '');
            const formattedDate = date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}` : r.timestamp;
            
            return {
                ...r,
                timestamp: formattedDate,
                contact: r.contact ? r.contact.replace(/[^0-9]/g, '').replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : r.contact
            };
        });

        // Clean up internal fields before saving
        const cleanToSave: Installation[] = standardRecords.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            productName: r.productName,
            companyName: r.companyName,
            userName: r.userName,
            contact: r.contact,
            machineId: r.machineId,
            actionType: r.actionType,
            result: r.result,
            ip: r.ip,
            version: r.version
        }));

        await saveInstallations(cleanToSave, currentProgram?.programId);
        alert("데이터 표준화 완료! 모든 형식이 통일되었습니다.");
        await loadData(true, false);
    } catch (e: any) {
        alert("표준화 중 오류: " + e.message);
    } finally {
        setIsCleaning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in h-full relative">
      {cleanupCount > 0 && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 animate-bounce-in">
              <div className="bg-green-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-bold">
                  <i className="fas fa-broom"></i>
                  <span>중복 로그 {cleanupCount}개를 정리했습니다!</span>
              </div>
          </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
            <h2 className="text-xl font-bold text-gray-800 flex items-center">
            <i className="fas fa-microchip text-indigo-500 mr-2"></i>설치/실행 로그 (InstallLogs)
            </h2>
            <p className="text-xs text-gray-500 mt-1">
            마우스로 열 너비를 조절할 수 있습니다. (설정값 자동 저장)
            </p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative w-full md:w-64">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input 
                    type="text" 
                    placeholder="고객명, 연락처, 기기ID 검색..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium placeholder-gray-400 text-gray-800"
                />
                {searchQuery && (
                    <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs animate-fade-in"
                    >
                        <i className="fas fa-times-circle"></i>
                    </button>
                )}
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg w-full md:w-auto justify-center">
                <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'ALL' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>전체 ({records.length})</button>
                <button onClick={() => setFilter('TRIAL')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'TRIAL' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500'}`}>체험판</button>
                <button onClick={() => setFilter('PENDING')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'PENDING' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'}`}>미인증</button>
                <button onClick={() => setFilter('ACTIVATED')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filter === 'ACTIVATED' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500'}`}>정품</button>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex justify-end gap-2 bg-gray-50">
          <button 
            onClick={handleStandardize} 
            disabled={isCleaning}
            className="text-xs bg-white border border-indigo-200 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-50 font-bold transition-colors flex items-center"
          >
              <i className={`fas fa-magic mr-1 ${isCleaning ? 'fa-spin' : ''}`}></i>
              표준화(통일)
          </button>
          <button 
            onClick={handleManualCleanup} 
            disabled={isCleaning}
            className="text-xs bg-white border border-red-200 text-red-600 px-3 py-1 rounded hover:bg-red-50 font-bold transition-colors flex items-center"
          >
              <i className={`fas fa-broom mr-1 ${isCleaning ? 'fa-spin' : ''}`}></i>
              {isCleaning ? '정리 중...' : '중복 정리'}
          </button>
        </div>
        
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="text-center py-20 text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i> 목록을 불러오는 중...
            </div>
          ) : sortedRecords.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="font-bold mb-2">데이터가 없습니다.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse table-fixed">
              <colgroup>
                {COLUMN_DEFS.map(col => (
                  <col key={col.id} style={{ width: colWidths[col.id] || col.width }} />
                ))}
              </colgroup>
              <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase sticky top-0 shadow-sm z-10 select-none">
                <tr>
                  {COLUMN_DEFS.map(col => (
                    <th 
                      key={col.id} 
                      className={`px-2 py-2 font-bold border-b relative group truncate text-center border-r border-gray-200/50 last:border-r-0 cursor-pointer hover:bg-gray-100 transition-colors ${sortConfig.key === col.id ? 'bg-indigo-50/50 text-indigo-700' : ''}`}
                      onClick={() => {
                        if (col.id === 'actions') return;
                        const direction = sortConfig.key === col.id && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                        setSortConfig({ key: col.id, direction });
                      }}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {col.label}
                        {sortConfig.key === col.id && (
                          <i className={`fas fa-sort-amount-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[8px]`}></i>
                        )}
                      </div>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400 group-hover:bg-gray-300"
                        onMouseDown={(e) => {
                          setResizing({ id: col.id, startX: e.clientX, startWidth: colWidths[col.id] || col.width });
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[11px]">
                {sortedRecords.map((record, idx) => (
                  <tr key={`${record.machineId}-${idx}`} className={`transition-colors group hover:bg-gray-50`}>
                    <td className="px-2 py-2 text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis text-center">
                        {formatDate(record.timestamp)}
                    </td>
                    <td className="px-2 py-2 truncate font-medium text-gray-800" title={record.companyName}>
                        {record.companyName || '-'}
                    </td>
                    <td className="px-2 py-2 truncate text-center">
                      {record.matchedLicense?.userName ? (
                          <span className="font-bold text-indigo-700" title={record.matchedLicense.userName}>{record.matchedLicense.userName}</span>
                      ) : (
                          <span className="text-gray-800" title={record.userName}>{record.userName || '-'}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 truncate text-gray-800 font-mono text-center">
                        {record.contact || record.extractedContact || <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="flex items-center justify-center gap-1 w-full">
                            <span className={`font-mono text-[9px] truncate block leading-tight ${record.machineId?.startsWith('fallback') ? 'text-red-500 font-bold' : 'text-gray-400'}`} title={record.machineId}>
                                {record.machineId?.startsWith('fallback') && <i className="fas fa-exclamation-triangle mr-1"></i>}
                                {record.machineId}
                            </span>
                            {!deviceAliases[record.machineId || ''] && editingAlias?.deviceId !== record.machineId && (
                              <button 
                                onClick={() => setEditingAlias({deviceId: record.machineId!, currentAlias: ''})}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-500 transition-opacity"
                                title="별칭 추가"
                              >
                                <i className="fas fa-edit text-[8px]"></i>
                              </button>
                            )}
                          </div>

                          {(deviceAliases[record.machineId || ''] || editingAlias?.deviceId === record.machineId) && (
                            <div className="flex items-center justify-center gap-1 mt-0.5">
                              {editingAlias?.deviceId === record.machineId ? (
                                <>
                                  <input 
                                    type="text" 
                                    className="text-[9px] border rounded px-1 w-20 h-4" 
                                    value={editingAlias.currentAlias}
                                    onChange={(e) => setEditingAlias({...editingAlias, currentAlias: e.target.value})}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveAlias(record.machineId!, editingAlias.currentAlias);
                                      if (e.key === 'Escape') setEditingAlias(null);
                                    }}
                                  />
                                  <button onClick={() => handleSaveAlias(record.machineId!, editingAlias.currentAlias)} className="text-green-600 hover:text-green-800"><i className="fas fa-check text-[8px]"></i></button>
                                </>
                              ) : (
                                <>
                                  <span className="text-[9px] text-indigo-500 font-bold truncate max-w-[100px] leading-none">
                                    {deviceAliases[record.machineId || '']}
                                  </span>
                                  <button 
                                    onClick={() => setEditingAlias({deviceId: record.machineId!, currentAlias: deviceAliases[record.machineId!] || ''})}
                                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-indigo-500 transition-opacity"
                                    title="별칭 수정"
                                  >
                                    <i className="fas fa-edit text-[8px]"></i>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                    </td>
                    <td className="px-2 py-2 text-[10px] text-gray-500 truncate text-center">
                        {record.actionType}
                    </td>
                    <td className="px-2 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            record.status === 'ACTIVATED' ? 'bg-green-50 text-green-700 border-green-200' :
                            record.status === 'TRIAL' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            'bg-orange-50 text-orange-700 border-orange-200'
                        }`}>
                            {record.status === 'ACTIVATED' ? '정품' : record.status === 'TRIAL' ? '체험' : '미인증'}
                        </span>
                    </td>
                    <td className="px-2 py-2 text-[10px] text-gray-400 text-center">
                        {record.ip || '-'}
                    </td>
                    <td className="px-2 py-2 text-center">
                         {record.version ? (
                            <span className="px-1 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded border border-blue-100">{record.version}</span>
                         ) : '-'}
                    </td>
                    <td className="px-2 py-2 font-bold text-gray-700 truncate" title={record.productName}>
                        {record.productName}
                    </td>
                    <td className="px-2 py-2 text-right">
                        {record.status !== 'ACTIVATED' ? (
                            <button onClick={() => handleIssueLicense(record)} className="bg-indigo-600 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-indigo-700 shadow-sm transition-all whitespace-nowrap">발급</button>
                        ) : (
                             <i className="fas fa-check-circle text-green-500 pr-2"></i>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstallLogs;
