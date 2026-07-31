
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LicenseRequest, RequestStatus, Product, License, LicenseStatus, LicenseType, PROGRAM_IDS } from '../types';
import { getAllLicenseRequests, getAllProducts, deleteLicenseRequest, getAllLicenses, saveLicenseRequest, getAppConfig, getAllInstallations, saveLicense, generateSerialKey } from '../services/storageService';
import { getLatestVersionFromLogs, compareVersions } from '../services/versionService';
import { Installation } from '../types';

// [NEW] Interface for match result
interface MatchResult {
    license: License;
    reasons: string[];
}

const RequestManager: React.FC = () => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<(LicenseRequest & { programId: PROGRAM_IDS })[]>([]);
  const [products, setProducts] = useState<(Product & { programId: PROGRAM_IDS })[]>([]);
  const [licenses, setLicenses] = useState<(License & { programId: PROGRAM_IDS })[]>([]);
  const [installationLogs, setInstallationLogs] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(false); 

  // Delete Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<(LicenseRequest & { programId: PROGRAM_IDS }) | null>(null);

  // Duplicate User Action Modal State (승인/원격적용 공용)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [actionableRequest, setActionableRequest] = useState<{
    request: LicenseRequest & { programId: PROGRAM_IDS };
    existingMatches: MatchResult[];
    mode: 'approve' | 'remote';
  } | null>(null);

  // [NEW] View Mode State (Filter by current program by default)
  const [viewMode, setViewMode] = useState<'current' | 'all'>('current');
  // [NEW] Current Program Config
  const [currentPid, setCurrentPid] = useState<PROGRAM_IDS | null>(null);

  // [NEW] SMS Modal State
  const [smsModal, setSmsModal] = useState<{ show: boolean; contact: string; content: string }>({ show: false, contact: '', content: '' });

  useEffect(() => {
    const config = getAppConfig();
    const active = config.programs.find(p => p.id === config.currentProgramId);
    if (active) setCurrentPid(active.programId);
  }, []);

  const extractPhoneFromName = (name: string): { name: string, contact: string | null } => {
      if (!name) return { name: '', contact: null };
      const str = String(name);
      const phoneRegex = /(01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}/;
      const match = str.match(phoneRegex);
      if (match) {
          const contact = match[0];
          const cleanName = str.replace(contact, '').replace(/[()]/g, '').trim();
          return { name: cleanName, contact: contact };
      }
      return { name: str, contact: null };
  };

  useEffect(() => { refreshData(false); }, []);
  
  // 자동 새로고침 (30초, 캐시 우선)
  useEffect(() => {
    const interval = setInterval(() => { refreshData(false); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // [NEW] Global Refresh Event Listener
  useEffect(() => {
    const handleGlobalRefresh = () => {
        refreshData(true, true);
    };
    window.addEventListener('REFRESH_DATA', handleGlobalRefresh);
    return () => window.removeEventListener('REFRESH_DATA', handleGlobalRefresh);
  }, []);

  const refreshData = async (showLoading = false, force = false) => {
    if (showLoading) setLoading(true);
    try {
        const [reqs, prods, lics, logs] = await Promise.all([
            getAllLicenseRequests(force), 
            getAllProducts(force),
            getAllLicenses(force),
            getAllInstallations(force)
        ]);
        
        reqs.sort((a, b) => {
            const timeA = new Date(a.createdAt || 0).getTime();
            const timeB = new Date(b.createdAt || 0).getTime();
            return (timeB || 0) - (timeA || 0);
        });

        setRequests(reqs);
        setProducts(prods);
        setLicenses(lics);
        setInstallationLogs(logs);
    } catch(e) {
        console.error("Failed to load requests:", e);
    } finally {
        if (showLoading) setLoading(false);
    }
  };

  const cleanString = (s: any) => (String(s || '')).replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
  
  const formatDate = (dateStr: string) => {
      if (!dateStr) return '-';
      try {
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return dateStr; 
          return d.toLocaleDateString('ko-KR', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit'
          });
      } catch {
          return dateStr;
      }
  };

  // --- Helper to check if a license/request matches the product ---
  const isSameProduct = (reqName: string | undefined, licenseOrReq: { productId?: string; productName?: string; programId?: PROGRAM_IDS }, reqProgramId?: PROGRAM_IDS) => {
    const rName = cleanString(reqName || '');
    
    // If programIds are different, they are definitely not the same product
    if (reqProgramId && licenseOrReq.programId && reqProgramId !== licenseOrReq.programId) return false;

    // 1. Try match via Product ID if available
    if (licenseOrReq.productId) {
        const product = products.find(p => p.id === licenseOrReq.productId && p.programId === licenseOrReq.programId);
        if (product) {
            const pName = cleanString(product.name);
            return pName === rName || (rName.length >= 2 && pName.includes(rName)) || (pName.length >= 2 && rName.includes(pName));
        }
    }
    
    // 2. Fallback to product name string
    const lName = cleanString(licenseOrReq.productName || '');
    return lName === rName || (rName.length >= 2 && lName.includes(rName)) || (lName.length >= 2 && rName.includes(lName));
  };

  // --- [UPDATE] Helper to find existing licenses with REASONS ---
  const findExistingLicenses = (req: LicenseRequest & { programId: PROGRAM_IDS }): MatchResult[] => {
    const clean = (s: any) => (String(s || '')).trim().replace(/-/g, '').toLowerCase();
    
    const reqName = clean(req.name);
    const reqContact = clean(req.contact);
    const reqMachine = clean(req.machineId);

    if (!reqName && !reqContact && !reqMachine) return [];

    const results: MatchResult[] = [];

    // [COMBINED] Search across all licenses, but prioritize same program
    licenses.forEach(l => {
        const lName = clean(l.userName);
        const lContact = clean(l.contactInfo);
        const lMachine = clean(l.machineId);
        
        const reasons: string[] = [];

        // 1. Machine ID Match (Strongest)
        if (reqMachine.length > 5 && lMachine.length > 5 && lMachine === reqMachine) {
            reasons.push('기기 ID 일치');
        }

        // 2. Contact Match (Strong)
        if (reqContact.length > 8 && lContact.length > 8 && (lContact.includes(reqContact) || reqContact.includes(lContact))) {
            reasons.push('연락처 일치');
        }

        // 3. Name Match (Weakest)
        if (reqName.length >= 2 && lName.length >= 2 && lName === reqName) {
            reasons.push('이름 일치');
        }

        if (reasons.length > 0) {
            // Add program info to reasons if different
            if (l.programId !== req.programId) {
                reasons.push(`${l.programId === PROGRAM_IDS.EZIMPO ? 'EzImpo' : 'EzPrintWork'} 기록`);
            }
            results.push({ license: l, reasons });
        }
    });

    return results;
  };


  // --- Duplicate Check Logic (for UI tag) ---
  const getDuplicateStatus = (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
    // 1. Find ANY license for this user
    const matches = findExistingLicenses(req);
    
    // 2. Filter for SAME PRODUCT only
    const sameProductMatches = matches.filter(m => isSameProduct(req.productName, m.license, req.programId));

    if (sameProductMatches.length > 0) {
      // Check if they have ANY Official (Paid/Lifetime/Subscription) license
      const hasOfficial = sameProductMatches.some(m => 
          m.license.type !== LicenseType.TRIAL && 
          !m.license.key.toLowerCase().includes('test') && 
          !m.license.key.toLowerCase().includes('trial')
      );

      if (hasOfficial) {
          const isExpired = sameProductMatches.some(m => m.license.status === LicenseStatus.EXPIRED);
          if (isExpired) {
              return { text: '만료', className: 'bg-gray-100 text-gray-600 border-gray-200' };
          }
          return { text: '기존', className: 'bg-blue-100 text-blue-700 border-blue-200' };
      } else {
          return { text: 'TEST', className: 'bg-purple-100 text-purple-700 border-purple-200' };
      }
    }

    // Check for duplicate PENDING requests
    const clean = (s: any) => (String(s || '')).trim().replace(/-/g, '').toLowerCase();
    const duplicatePending = requests.find(r => {
        if (r.id === req.id || r.status === RequestStatus.PROCESSED) return false;
        
        // Different product requests are NOT duplicates
        if (!isSameProduct(req.productName, { productName: r.productName, programId: r.programId }, req.programId)) return false;

        const rName = clean(r.name);
        const rContact = clean(r.contact);
        const rMachine = clean(r.machineId);
        const reqName = clean(req.name);
        const reqContact = clean(req.contact);
        const reqMachine = clean(req.machineId);
        
        const nameMatch = reqName.length > 1 && rName === reqName;
        const contactMatch = reqContact.length > 7 && rContact === reqContact;
        const machineMatch = reqMachine.length > 5 && rMachine === reqMachine;

        return nameMatch || contactMatch || machineMatch;
    });
    
    if (duplicatePending) {
        return { text: '중복', className: 'bg-orange-100 text-orange-700 border-orange-200' };
    }

    return { text: '신규', className: 'bg-green-100 text-green-700 border-green-200' };
  };

  // --- Deletion Flow ---
  const promptDelete = (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
    setItemToDelete(req);
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setLoading(true);
    setShowConfirmModal(false);
    try {
      await deleteLicenseRequest(itemToDelete.id, itemToDelete.programId);
      setItemToDelete(null);
      await refreshData(true);
    } catch (e) {
      console.error("Failed to delete request:", e);
      alert("요청 삭제에 실패했습니다.");
      setLoading(false);
    }
  };

  // --- Approval Flow ---
  const handleTransferToManager = async (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
    let { name: processedName, contact: extractedContact } = extractPhoneFromName(req.name || '');
    const matchedProduct = products.find(p => p.programId === req.programId && cleanString(p.name) === cleanString(req.productName));

    // [FIX] 시트에 이미 연락처가 있다면 그것을 우선 사용
    if (req.contact && req.contact.trim()) {
        extractedContact = req.contact.trim();
    }

    processedName = processedName.replace(/[(\[]?\s*01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\s*[)\]]?/g, '');
    processedName = processedName.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
    
    if (extractedContact) {
        processedName = String(processedName).replace(String(extractedContact), '');
        const contactNoHyphen = String(extractedContact).replace(/-/g, '');
        if (contactNoHyphen.length > 9) {
             processedName = String(processedName).replace(contactNoHyphen, '');
        }
    }
    
    processedName = processedName.trim();

    setLoading(true);
    try {
        // 1. 자동 라이선스 생성
        const newLicense: License = {
            id: `lic-${Math.random().toString(36).substring(2, 11)}`,
            programId: req.programId,
            key: generateSerialKey(req.programId === PROGRAM_IDS.EZIMPO ? 'EZIM' : 'EZPW'),
            status: LicenseStatus.ACTIVE,
            paymentStatus: 'PAID', // 요청 승인이므로 결제 완료 상태
            userName: processedName,
            companyName: req.companyName || '',
            contactInfo: extractedContact || req.contact || '',
            productId: matchedProduct ? matchedProduct.id : (products.length > 0 ? products[0].id : ''),
            productName: matchedProduct ? matchedProduct.name : req.productName,
            type: LicenseType.LIFETIME,
            requestId: req.id,
            createdAt: new Date().toISOString(),
            expiresAt: null
        };

        // DB에 라이선스 저장
        await saveLicense(newLicense, req.programId);

        // 2. 요청 상태를 PROCESSED로 변경
        const updatedReq = { ...req, status: RequestStatus.PROCESSED };
        await saveLicenseRequest(updatedReq, req.programId);

        // 3. 라이선스 전송 화면으로 이동
        sessionStorage.removeItem('AUTO_CREATE_DATA');
        
        // 상태 갱신을 위해 이벤트 발생 (백그라운드 갱신용)
        window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
        
        // 전송 화면으로 이동
        navigate('/delivery');
        
    } catch (e) {
        console.error("Failed to auto-create license", e);
        alert("라이선스 자동 생성에 실패했습니다.");
    } finally {
        setLoading(false);
    }
  };

  /** 신규 키 생성 + PushStatus=READY (실제 원격 발급) */
  const executeRemoteApplyNew = async (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
    let { name: processedName, contact: extractedContact } = extractPhoneFromName(req.name || '');
    if (req.contact && req.contact.trim()) extractedContact = req.contact.trim();
    processedName = processedName.replace(/[(\[]?\s*01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\s*[)\]]?/g, '').replace(/\(\s*\)/g, '').trim();
    const displayUser = (req.userName || processedName || req.name || '').trim();
    const matchedProduct = products.find(p => p.programId === req.programId && cleanString(p.name) === cleanString(req.productName));

    setLoading(true);
    try {
      const newLicense: License = {
        id: `lic-${Math.random().toString(36).substring(2, 11)}`,
        programId: req.programId,
        key: generateSerialKey(req.programId === PROGRAM_IDS.EZIMPO ? 'EZIM' : 'EZPW'),
        status: LicenseStatus.ACTIVE,
        paymentStatus: 'PAID',
        pin: req.pin || '',
        userName: displayUser,
        companyName: req.companyName || '',
        contactInfo: extractedContact || req.contact || '',
        machineId: req.machineId,
        productId: matchedProduct ? matchedProduct.id : (products.length > 0 ? products[0].id : ''),
        productName: matchedProduct ? matchedProduct.name : req.productName,
        type: LicenseType.LIFETIME,
        requestId: req.id,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        pushStatus: 'READY',
      };

      await saveLicense(newLicense, req.programId);
      await saveLicenseRequest({ ...req, status: RequestStatus.PROCESSED }, req.programId);
      window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
      alert(`원격 적용 준비 완료 (신규 발급)\n\n키: ${newLicense.key}\n기기: ${req.machineId}\n\n고객이 EzImpo를 실행 중이면 약 30초 내에 체험판→정품으로 전환됩니다.`);
      await refreshData(true, true);
    } catch (e) {
      console.error(e);
      alert('원격 적용 라이선스 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  /** 기존 키를 READY로 원격 재적용 (새 키 발급 없음) */
  const executeRemoteApplyExisting = async (
    req: LicenseRequest & { programId: PROGRAM_IDS },
    existingLicense: License & { programId: PROGRAM_IDS }
  ) => {
    setLoading(true);
    try {
      const updated: License & { programId: PROGRAM_IDS } = {
        ...existingLicense,
        machineId: req.machineId || existingLicense.machineId,
        pin: (req.pin && String(req.pin).length >= 4) ? String(req.pin) : (existingLicense.pin || ''),
        contactInfo: req.contact || existingLicense.contactInfo,
        companyName: req.companyName || existingLicense.companyName,
        userName: (req.userName || '').trim() || existingLicense.userName,
        status: LicenseStatus.ACTIVE,
        paymentStatus: 'PAID',
        pushStatus: 'READY',
        requestId: req.id,
      };
      await saveLicense(updated, req.programId);
      await saveLicenseRequest({ ...req, status: RequestStatus.PROCESSED }, req.programId);
      window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
      alert(`원격 적용 준비 완료 (기존 키 재사용)\n\n키: ${updated.key}\n기기: ${updated.machineId}\n\n고객이 EzImpo를 실행·인증 모달을 열면 기존 키로 정품 전환됩니다.`);
      await refreshData(true, true);
      setShowDuplicateModal(false);
      setActionableRequest(null);
    } catch (e: any) {
      console.error(e);
      alert('기존 키 원격 적용 실패: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  /** 입금 확인 후 원격 적용 — 기존 라이선스 있으면 선택 모달 */
  const handleRemoteApply = async (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
    if (req.status === RequestStatus.PROCESSED) {
      alert('이미 처리된 요청입니다.');
      return;
    }
    if (!req.machineId || req.machineId.length < 5) {
      alert('기기ID(HWID)가 없어 원격 적용할 수 없습니다. 기존 승인(문자 발송)을 이용해 주세요.');
      return;
    }
    if (!req.pin || String(req.pin).length < 4) {
      if (!window.confirm('요청에 PIN이 없습니다. PIN 없이 원격 적용하면 고객 앱에서 실패할 수 있습니다. 계속할까요?')) return;
    }

    const matches = findExistingLicenses(req);
    const sameProductMatches = matches.filter(m => isSameProduct(req.productName, m.license, req.programId));

    if (sameProductMatches.length > 0) {
      setActionableRequest({ request: req, existingMatches: sameProductMatches, mode: 'remote' });
      setShowDuplicateModal(true);
      return;
    }

    await executeRemoteApplyNew(req);
  };
  
  const handleProcessRequest = (req: LicenseRequest & { programId: PROGRAM_IDS }) => {
      if (req.status === RequestStatus.PROCESSED) {
          alert("이미 처리된 요청입니다.");
          return;
      }
      
      const matches = findExistingLicenses(req);
      const sameProductMatches = matches.filter(m => isSameProduct(req.productName, m.license, req.programId));

      if (sameProductMatches.length > 0) {
        setActionableRequest({ request: req, existingMatches: sameProductMatches, mode: 'approve' });
        setShowDuplicateModal(true);
      } else {
        handleTransferToManager(req);
      }
  };

  const handleIssueNewForExistingUser = () => {
    if (!actionableRequest) return;
    const req = actionableRequest.request;
    const mode = actionableRequest.mode;
    setShowDuplicateModal(false);
    setActionableRequest(null);
    if (mode === 'remote') {
      executeRemoteApplyNew(req);
    } else {
      handleTransferToManager(req);
    }
  };
  
  const handleProcessWithExistingLicense = async (existingLicense: License & { programId: PROGRAM_IDS }) => {
      if (!actionableRequest) return;
      if (actionableRequest.mode === 'remote') {
          await executeRemoteApplyExisting(actionableRequest.request, existingLicense);
          return;
      }
      setLoading(true);
      try {
          const updatedReq = { ...actionableRequest.request, status: RequestStatus.PROCESSED };
          await saveLicenseRequest(updatedReq, actionableRequest.request.programId);
          
          navigator.clipboard.writeText(existingLicense.key);
          
          await refreshData(true);
          
          setShowDuplicateModal(false);
          setActionableRequest(null);
          
          alert(`[처리 완료]\n\n기존 라이선스 키(${existingLicense.key})를 클립보드에 복사했습니다.\n\n이 요청은 '처리 완료' 상태로 변경되어 목록에서 제외되었습니다.`);

      } catch (e: any) {
          alert("처리 중 오류 발생: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  // [NEW] SMS Sending Logic
  const handleOpenSmsModal = (req: LicenseRequest) => {
      const defaultText = `[LicenseFlow] ${req.name} 고객님, 요청하신 '${req.productName}' 라이선스 발급이 접수되었습니다. 입금 확인 후 빠르게 처리해 드리겠습니다.`;
      setSmsModal({ show: true, contact: req.contact || '', content: defaultText });
  };

  const handleSendSms = () => {
      if (!smsModal.contact) return;
      try {
          const phoneNumber = smsModal.contact.replace(/[^0-9+]/g, '');
          if (!phoneNumber) {
              alert("유효한 전화번호가 아닙니다.");
              return;
          }
          const messageBody = encodeURIComponent(smsModal.content);
          const smsLink = `sms:${phoneNumber}?&body=${messageBody}`;
          window.open(smsLink, '_blank');
          setSmsModal({ ...smsModal, show: false });
      } catch (e) {
          alert("문자 앱을 여는 데 실패했습니다.");
      }
  };


  const pendingRequests = requests.filter(r => {
      const isPending = r.status !== RequestStatus.PROCESSED && r.status !== RequestStatus.REJECTED;
      if (!isPending) return false;
      
      // [FORCE SHOW] '현재 프로그램 내역' 모드에서도 다른 프로그램 데이터가 있다면 필터링하지 않고 보여주기 위해 조건 완화
      if (viewMode === 'current' && currentPid) {
          // 프로그램이 일치하거나, 프로그램 정보가 없는 경우 표시
          return r.programId === currentPid || !r.programId;
      }
      return true;
  });
  const processedRequests = requests.filter(r => {
      const isProcessed = r.status === RequestStatus.PROCESSED;
      if (!isProcessed) return false;
      if (viewMode === 'current' && currentPid) {
          return r.programId === currentPid;
      }
      return true;
  });

  return (
    <div className="flex flex-col gap-1 animate-fade-in h-full relative">
        <div className="bg-gradient-to-r from-orange-500 to-pink-500 rounded-xl py-2 px-4 text-white shadow-lg shrink-0">
          <div className="flex justify-between items-center">
             <div>
                 <h2 className="text-base font-bold flex items-center gap-2"><i className="fas fa-bell"></i> 라이선스 요청 관리 {viewMode === 'current' ? `(${currentPid === PROGRAM_IDS.EZIMPO ? 'EzImpo' : 'EzPrintWork'})` : '(전체 통합)'}</h2>
                 <p className="text-white/80 text-[10px]">사용자 요청을 확인하고 승인하세요.</p>
             </div>
             <div className="flex items-center gap-4">
                <div className="flex bg-white/20 p-1 rounded-lg border border-white/20 backdrop-blur-sm">
                   <button 
                     onClick={() => setViewMode('current')}
                     className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'current' ? 'bg-white text-orange-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
                   >현재 프로그램 내역</button>
                   <button 
                     onClick={() => setViewMode('all')}
                     className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${viewMode === 'all' ? 'bg-white text-orange-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
                   >전체 통합 내역</button>
                </div>
                <div className="text-right">
                    <div className="text-xl font-bold leading-none">{pendingRequests.length}</div>
                    <div className="text-[10px] opacity-70 ml-2 font-normal">(전체 로드: {requests.length})</div>
                    <div className="text-[9px] text-white/80 uppercase tracking-wider">대기 중</div>
                </div>
             </div>
          </div>
        </div>

       {loading && (
        <div className="absolute inset-0 bg-white/70 z-20 flex items-center justify-center backdrop-blur-sm rounded-xl">
           <div className="text-indigo-600 font-bold flex flex-col items-center">
             <i className="fas fa-spinner fa-spin text-3xl mb-2"></i> 
             <span>데이터 새로고침 중...</span>
           </div>
        </div>
       )}

       <div className="flex-1 flex flex-col gap-4 min-h-0">
           <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden flex-1 relative">
              <div className="p-3 border-b border-gray-100 bg-orange-50/50 shrink-0 flex justify-between items-center">
                 <h3 className="font-bold text-orange-800 flex items-center text-sm"><i className="fas fa-clock mr-2"></i> 처리 대기 목록</h3>
              </div>

              <div className="flex-1 overflow-auto relative">
                 <table className="w-full text-left">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0 z-10 shadow-sm">
                       <tr>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">프로그램</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">요청 일시</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">입금자 (회사)</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">연락처</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">이메일</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">제품 / 상태</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50">버전</th>
                          <th className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-right">작업</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                       {!loading && pendingRequests.length === 0 && (<tr><td colSpan={7} className="p-12 text-center text-gray-400">대기 중인 요청이 없습니다.</td></tr>)}
                       {pendingRequests.map(req => {
                           const hasMachineId = !!req.machineId && req.machineId.length > 5;
                           const dupInfo = getDuplicateStatus(req);
                           return (
                           <tr key={req.id} className="hover:bg-orange-50 transition-colors">
                              <td className="px-4 py-2">
                                 <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${req.programId === PROGRAM_IDS.EZIMPO ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                                     {req.programId === PROGRAM_IDS.EZIMPO ? 'EzImpo' : 'EzPrintWork'}
                                 </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">{formatDate(req.createdAt)}</td>
                              <td className="px-4 py-2">
                                 <div className="flex items-center gap-2">
                                     <span className="font-bold text-gray-800 whitespace-nowrap">{req.name || '(이름 없음)'}</span>
                                     {req.companyName && (<span className="text-xs text-gray-500 whitespace-nowrap">({req.companyName})</span>)}
                                 </div>
                                 {req.userName && req.userName !== req.name && (
                                   <div className="text-[10px] text-indigo-600 mt-0.5">사용자: {req.userName}</div>
                                 )}
                                 {req.pin && <div className="text-[9px] text-gray-400 font-mono">PIN 등록됨</div>}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
                                  {req.contact || '-'}
                                  {req.contact && req.contact.length > 8 && (
                                      <button 
                                        onClick={() => handleOpenSmsModal(req)}
                                        className="ml-2 text-green-500 hover:text-green-700 bg-green-50 rounded-full w-6 h-6 inline-flex items-center justify-center transition-colors"
                                        title="문자 보내기"
                                      >
                                          <i className="fas fa-comment-dots text-xs"></i>
                                      </button>
                                  )}
                              </td>
                              <td className="px-4 py-2 text-xs text-indigo-600 font-medium truncate max-w-[150px]" title={req.email}>
                                  {req.email || '-'}
                              </td>
                              <td className="px-4 py-2">
                                 <div className="flex items-center gap-2">
                                    <div className="inline-block bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded font-bold whitespace-nowrap">{req.productName}</div>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold whitespace-nowrap ${dupInfo.className}`}>{dupInfo.text}</span>
                                    {hasMachineId ? (<span className="text-[10px] text-green-700 font-bold font-mono bg-green-100 px-2 py-0.5 rounded border border-green-200 inline-flex items-center shadow-sm whitespace-nowrap"><i className="fas fa-microchip mr-1"></i>기기</span>) : (<span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded border border-gray-200 whitespace-nowrap">미등록</span>)}
                                 </div>
                              </td>
                               <td className="px-4 py-2">
                                  <div className="flex flex-col gap-1 items-center justify-center">
                                    <span className="inline-flex items-center justify-center text-[10px] text-gray-500 font-mono font-medium border border-gray-200 px-1.5 py-0.5 rounded bg-gray-50" title="요청서에 적힌 버전">{req.version || 'N/A'}</span>
                                    {req.machineId && (() => {
                                        const actualVer = getLatestVersionFromLogs(req.machineId, installationLogs);
                                        if (!actualVer || actualVer === req.version) return null;
                                        const isNewer = compareVersions(actualVer, req.version) > 0;
                                        return (
                                            <span className={`text-[9px] font-bold px-1.5 rounded-full border ${isNewer ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`} title="로그상 실제 마지막 사용 버전">
                                                <i className={`fas fa-history mr-1`}></i>{actualVer}
                                            </span>
                                        );
                                    })()}
                                  </div>
                               </td>
                              <td className="px-4 py-2 text-right">
                                 <div className="flex items-center justify-end gap-2">
                                   {req.programId === PROGRAM_IDS.EZIMPO && (
                                     <button
                                       onClick={() => handleRemoteApply(req)}
                                       className="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold shadow-md hover:bg-emerald-700 transition-all flex items-center gap-1 whitespace-nowrap"
                                       title="키 발행 후 고객 PC에 원격 적용 (문자 입력 불필요)"
                                     >
                                       <i className="fas fa-bolt"></i> 원격적용
                                     </button>
                                   )}
                                   <button onClick={() => handleProcessRequest(req)} className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-bold shadow-md hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center gap-1 whitespace-nowrap"><i className="fas fa-share-square"></i> 승인(문자)</button>
                                   <button onClick={() => promptDelete(req)} className="text-red-400 hover:text-red-600 px-2 py-1.5 rounded hover:bg-red-50 transition-colors" title="요청 삭제"><i className="fas fa-trash"></i></button>
                                 </div>
                              </td>
                           </tr>
                       )})}
                    </tbody>
                 </table>
              </div>
           </div>

           <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden flex-1 opacity-90 hover:opacity-100 transition-opacity">
              <div className="p-3 border-b border-gray-100 shrink-0"><h3 className="font-bold text-gray-600 text-sm">최근 처리 내역</h3></div>
              <div className="flex-1 overflow-auto relative">
                 <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-400 sticky top-0 z-10 shadow-sm">
                        <tr className="border-b border-gray-100">
                            <th className="pb-2 pt-2 px-4 bg-gray-50">프로그램</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50">처리 일시</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50">이름 (회사)</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50">연락처</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50">제품</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50">버전</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50 text-center">전송상태</th>
                            <th className="pb-2 pt-2 px-4 bg-gray-50 text-right">삭제</th>
                        </tr>
                    </thead>
                    <tbody>
                       {processedRequests.map(req => (
                           <tr key={req.id} className="border-b border-gray-50 last:border-0 text-gray-600 hover:bg-gray-50">
                               <td className="py-2 px-4">
                                   <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${req.programId === PROGRAM_IDS.EZIMPO ? 'text-blue-500' : 'text-green-500'}`}>
                                       {req.programId === PROGRAM_IDS.EZIMPO ? 'EzImpo' : 'EzPrintWork'}
                                   </span>
                               </td>
                               <td className="py-2 px-4 text-xs text-gray-500">{formatDate(req.createdAt)}</td>
                               <td className="py-2 px-4">
                                   <span className="font-medium text-gray-800">{req.name}</span>
                                   {req.companyName && <span className="text-xs text-gray-500 ml-1">({req.companyName})</span>}
                               </td>
                               <td className="py-2 px-4 text-xs text-gray-500">{req.contact || '-'}</td>
                               <td className="py-2 px-4">{req.productName}</td>
                               <td className="py-2 px-4">
                                   <span className="text-[10px] text-gray-500 font-mono">{req.version || 'N/A'}</span>
                               </td>
                               <td className="py-2 px-4 text-center">
                                   {(() => {
                                       const linkedLicense = licenses.find(l => l.requestId === req.id);
                                       if (!linkedLicense) return <span className="text-gray-300 text-[10px]">-</span>;
                                       return linkedLicense.lastSmsSent ? (
                                           <span className="text-[10px] text-green-700 font-bold bg-green-50 px-1.5 py-0.5 rounded shadow-sm inline-flex items-center gap-1" title={new Date(linkedLicense.lastSmsSent).toLocaleString()}>
                                               <i className="fas fa-check-double text-[8px]"></i>전송됨
                                           </span>
                                       ) : (
                                           <span className="text-[10px] text-orange-500 font-bold bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">대기중</span>
                                       );
                                   })()}
                               </td>
                               <td className="py-2 px-4 text-right">
                                   <button onClick={() => promptDelete(req)} className="text-gray-400 hover:text-red-600 px-2 rounded-lg hover:bg-red-50 transition-colors" title="기록 삭제">
                                       <i className="fas fa-trash-alt text-xs"></i>
                                   </button>
                               </td>
                           </tr>
                       ))}
                       {processedRequests.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-gray-400 text-xs">기록 없음</td></tr>}
                    </tbody>
                 </table>
              </div>
           </div>
       </div>

       {showConfirmModal && itemToDelete && (
         <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowConfirmModal(false)}>
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center animate-fade-in" onClick={e => e.stopPropagation()}>
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100"><i className="fas fa-exclamation-triangle text-red-600 text-xl"></i></div>
              <h3 className="text-lg font-medium leading-6 text-gray-900 mt-4">요청 삭제 확인</h3>
              <div className="mt-2 text-sm text-gray-500"><p>정말로 <strong className="font-bold text-gray-700 break-all">"{itemToDelete.name}"</strong> 님의 요청을 삭제하시겠습니까?</p><p className="mt-1">이 작업은 되돌릴 수 없습니다.</p></div>
              <div className="mt-6 flex gap-3"><button onClick={() => setShowConfirmModal(false)} className="flex-1 bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">취소</button><button onClick={confirmDelete} className="flex-1 bg-red-600 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-red-700">삭제</button></div>
           </div>
         </div>
       )}

       {showDuplicateModal && actionableRequest && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowDuplicateModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-xl font-bold text-gray-800">
                 <i className={`fas ${actionableRequest.mode === 'remote' ? 'fa-bolt text-emerald-500' : 'fa-users text-blue-500'} mr-2`}></i>
                 {actionableRequest.mode === 'remote' ? '원격적용 — 기존 라이선스 선택' : '기존 사용자 확인'}
               </h3>
               <button onClick={() => setShowDuplicateModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
             </div>
             
             <div className={`${actionableRequest.mode === 'remote' ? 'bg-emerald-50 border-emerald-400 text-emerald-800' : 'bg-blue-50 border-blue-400 text-blue-800'} border-l-4 p-4 text-sm rounded-r-lg mb-4`}>
               {actionableRequest.mode === 'remote' ? (
                 <>
                   <strong>{actionableRequest.request.companyName || actionableRequest.request.name}</strong> 님은 이미 이 제품 라이선스가 있습니다.
                   <br /><span className="text-xs opacity-80">기존 키를 원격 적용하거나, 추가 구매라면 새 키를 발급하세요.</span>
                 </>
               ) : (
                 <><strong>{actionableRequest.request.name}</strong> 님은 이미 <strong>이 제품의</strong> 라이선스를 보유하고 있습니다.</>
               )}
             </div>

             <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
               {actionableRequest.existingMatches.map((match, idx) => (
                 <div key={match.license.id || idx} className="bg-gray-50 p-3 rounded-lg border flex items-center justify-between gap-3">
                   <div className="min-w-0">
                     <p className="font-mono text-sm font-bold text-indigo-700 flex flex-wrap items-center gap-2">
                         {match.license.key}
                         {match.reasons.map(r => (
                             <span key={r} className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-200">{r}</span>
                         ))}
                     </p>
                     <p className="text-xs text-gray-600 mt-1">
                       {match.license.companyName || '-'} · {match.license.contactInfo || '-'} ·
                       <span className={`font-bold ml-1 ${match.license.status === 'ACTIVE' ? 'text-green-600' : 'text-red-600'}`}>{match.license.status}</span>
                     </p>
                   </div>
                   <button 
                     onClick={() => handleProcessWithExistingLicense(match.license)}
                     disabled={loading}
                     className={`${actionableRequest.mode === 'remote' ? 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'} border px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap disabled:opacity-50`}>
                     {actionableRequest.mode === 'remote' ? '이 키로 원격적용' : '기존 정보로 처리'}
                   </button>
                 </div>
               ))}
             </div>
             
             <div className="mt-6 pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-2">
                  {actionableRequest.mode === 'remote'
                    ? '추가 구매이거나 기존 키가 맞지 않으면 새 라이선스를 발급해 원격 적용합니다.'
                    : '또는, 이 사용자를 위해 완전히 새로운 라이선스를 발급할 수 있습니다 (추가 구매).'}
                </p>
                <button 
                  onClick={handleIssueNewForExistingUser}
                  disabled={loading}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-plus-circle mr-2"></i>
                  {actionableRequest.mode === 'remote' ? '새 키 발급 후 원격적용' : '새 라이선스 추가 발급'}
                </button>
             </div>

          </div>
        </div>
      )}

      {/* [NEW] SMS Modal */}
      {smsModal.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSmsModal({...smsModal, show: false})}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm animate-fade-in" onClick={e => e.stopPropagation()}>
             <div className="p-4 bg-green-600 text-white flex justify-between items-center rounded-t-xl">
               <h3 className="font-bold"><i className="fas fa-comment-dots mr-2"></i>문자 보내기</h3>
               <button onClick={() => setSmsModal({...smsModal, show: false})} className="hover:text-green-200"><i className="fas fa-times"></i></button>
             </div>
             <div className="p-6">
               <div className="mb-4">
                 <label className="block text-xs font-bold text-gray-500 mb-1">받는 사람</label>
                 <input 
                   type="text" 
                   value={smsModal.contact} 
                   onChange={(e) => setSmsModal({...smsModal, contact: e.target.value})}
                   className="w-full border border-gray-300 rounded p-2 text-sm bg-gray-50"
                 />
               </div>
               <div className="mb-4">
                 <label className="block text-xs font-bold text-gray-500 mb-1">내용</label>
                 <textarea 
                   value={smsModal.content}
                   onChange={(e) => setSmsModal({...smsModal, content: e.target.value})}
                   className="w-full h-32 border border-gray-300 rounded p-2 text-sm resize-none focus:ring-2 focus:ring-green-500 outline-none"
                 ></textarea>
               </div>
               <button 
                 onClick={handleSendSms}
                 className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition-colors flex items-center justify-center"
               >
                 <i className="fas fa-paper-plane mr-2"></i>전송 (앱 실행)
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestManager;
