
import React, { useState, useEffect, useMemo } from 'react';
import { 
  PROGRAM_IDS, 
  License, 
  LicenseStatus, 
  LicenseType, 
  Product, 
  SmsTemplate, 
  ActivityLog,
  Installation,
  DebugLog
} from '../types';
import { 
  getImpoLicenses, 
  saveImpoLicense, 
  saveImpoLicensesBulk,
  deleteImpoLicense, 
  deleteImpoLicensesBulk,
  resetImpoMachineId, 
  updateImpoMachineId,
  getImpoProducts,
  saveImpoProduct,
  deleteImpoProduct,
  sendImpoSms
} from '../services/ezImpoService';
import { getAppConfig } from '../services/storageService';
import { generateSerialKey, formatContactInput } from '../utils/helpers';
import { getInstallations, getDebugLogs } from '../services/storageService';
import { getLicenseVersionInfo, VersionInfo, normalizeMachineId, compareVersions } from '../services/versionService';

const COLUMN_DEFS = [
  { id: 'index', label: 'No.', width: 50 },
  { id: 'key', label: '라이선스 키', width: 155 },
  { id: 'pin', label: 'PIN', width: 65 },
  { id: 'userName', label: '고객명', width: 100 },
  { id: 'companyName', label: '상호명', width: 160 },
  { id: 'contactInfo', label: '연락처', width: 130 },
  { id: 'productName', label: '제품명', width: 140 },
  { id: 'machineId', label: '기기 ID', width: 220 },
  { id: 'lastCheckIn', label: '최근 접속', width: 130 },
  { id: 'createdAt', label: '등록일', width: 130 },
  { id: 'expiresAt', label: '만료일', width: 110 },
  { id: 'version', label: '버전', width: 130 },
  { id: 'status', label: '상태', width: 80 },
  { id: 'actions', label: '관리', width: 100 },
];

interface DuplicateGroup {
    key: string;
    userName: string;
    companyName: string;
    contactInfo: string;
    keepLicenses: License[];
    deleteLicenses: License[];
    licenses: License[];
}

const getDuplicateGroups = (lics: License[]): DuplicateGroup[] => {
    const groups: { [key: string]: License[] } = {};
    lics.forEach(l => {
        const contact = String(l.contactInfo || '').trim().replace(/[^0-9]/g, '');
        const name = String(l.userName || '').trim();
        if (!name || !contact) return;
        
        // 동일인 판별: 이름과 연락처만으로 그룹핑 (상호가 조금 달라도 동일인으로 간주)
        const groupKey = `${name}_${contact}`;
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(l);
    });
    
    const resultGroups: DuplicateGroup[] = [];
    
    Object.entries(groups).forEach(([groupKey, list]) => {
        if (list.length <= 1) return;
        
        // 1. 완벽히 동일한 라이선스 키 찾기
        const byKey: { [key: string]: License[] } = {};
        list.forEach(l => {
            const k = (l.key || '').trim().toUpperCase();
            if (!byKey[k]) byKey[k] = [];
            byKey[k].push(l);
        });
        
        const primaryLicenses: License[] = [];
        const duplicateKeyLicenses: License[] = [];
        
        Object.entries(byKey).forEach(([_, kList]) => {
            // 같은 키라면 가장 최근에 사용/등록된 것을 메인으로 선정
            kList.sort((a, b) => {
                const timeA = a.lastCheckIn ? new Date(a.lastCheckIn).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                const timeB = b.lastCheckIn ? new Date(b.lastCheckIn).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                return timeB - timeA;
            });
            primaryLicenses.push(kList[0]);
            duplicateKeyLicenses.push(...kList.slice(1));
        });
        
        // 2. 고유 키 라이선스들 중 보존(Keep)/삭제(Delete) 판별
        const isOfficial = (l: License) => {
            if ((l.key || '').toUpperCase() === 'TEST') return false;
            if (l.type === LicenseType.TRIAL) return false;
            // 만료되었더라도 정식 발급된 키라면 보존합니다. (고객이 나중에 연장 결제할 수 있으므로)
            return true;
        };
        
        const officials = primaryLicenses.filter(isOfficial);
        const trials = primaryLicenses.filter(l => !isOfficial(l));
        
        const keepList: License[] = [];
        const deleteList: License[] = [];
        
        if (officials.length > 0) {
            // 정식 라이선스는 모두 보존 (다중 구매 또는 만료 후 보존)
            keepList.push(...officials);
            // 구버전/체험판/테스트 키는 삭제
            deleteList.push(...trials);
        } else {
            // 정식 라이선스가 하나도 없다면, 가장 최근의 체험판 기록 1개만 남기고 삭제
            trials.sort((a, b) => {
                const timeA = a.lastCheckIn ? new Date(a.lastCheckIn).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                const timeB = b.lastCheckIn ? new Date(b.lastCheckIn).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                return timeB - timeA;
            });
            if (trials.length > 0) {
                keepList.push(trials[0]);
                deleteList.push(...trials.slice(1));
            }
        }
        
        // 완전히 동일한 키 중복건들은 무조건 삭제
        deleteList.push(...duplicateKeyLicenses);
        
        // 삭제할 대상이 실제로 있는 그룹만 결과에 포함
        if (deleteList.length > 0) {
            const sortedLics = [...keepList, ...deleteList];
            const first = keepList.length > 0 ? keepList[0] : deleteList[0];
            
            resultGroups.push({
                key: groupKey,
                userName: first.userName,
                companyName: first.companyName,
                contactInfo: first.contactInfo,
                keepLicenses: keepList,
                deleteLicenses: deleteList,
                licenses: sortedLics
            });
        }
    });
    
    return resultGroups;
};

const EzImpoLicenseManager: React.FC = () => {
    const [licenses, setLicenses] = useState<License[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [installations, setInstallations] = useState<Installation[]>([]);
    const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'licenses' | 'trials' | 'products' | 'versions'>('licenses');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ key: keyof License | 'index', direction: 'asc' | 'desc' }>({ key: 'index', direction: 'asc' });
    
    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [modalType, setModalType] = useState<'license' | 'product' | 'sms' | 'bulk'>('license');
    const [isEditing, setIsEditing] = useState(false);
    const [newLicense, setNewLicense] = useState<Partial<License>>({
        status: LicenseStatus.ACTIVE,
        paymentStatus: 'PAID',
        type: LicenseType.SUBSCRIPTION
    });
    const [newProduct, setNewProduct] = useState<Partial<Product>>({ price: 0 });
    const [selectedDuration, setSelectedDuration] = useState('LIFETIME');
    const [smsTarget, setSmsTarget] = useState({ contact: '', content: '', licenseId: '' });
    
    // Confirm modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<{type: 'license' | 'product', id: string, name: string} | null>(null);

    // Duplicate cleanup states
    const [showCleanupModal, setShowCleanupModal] = useState(false);
    const [isCleaningUp, setIsCleaningUp] = useState(false);

    useEffect(() => {
        loadAllData();
        
        // Listen for refresh events
        const handleRefresh = () => loadAllData();
        window.addEventListener('REFRESH_DATA', handleRefresh);
        return () => window.removeEventListener('REFRESH_DATA', handleRefresh);
    }, []);

    const loadAllData = async () => {
        setIsLoading(true);
        try {
            const [lics, prods, insts, dlogs] = await Promise.all([
                getImpoLicenses(true),
                getImpoProducts(true),
                getInstallations(true, PROGRAM_IDS.EZIMPO),
                getDebugLogs(true)
            ]);
            
            // 1. 기본 상태 세팅
            setLicenses(lics);
            setProducts(prods);
            setInstallations(insts);
            setDebugLogs(dlogs);

            // 2. 자동 버전 동기화 (설치/디버그 로그에 새 버전이 감지되면 구글 시트에 자동 저장)
            let hasChanges = false;
            const updatedLics = lics.map(l => {
                const vInfo = getLicenseVersionInfo(l, insts, prods, lics, dlogs);
                const detectedVer = vInfo.current;
                if (detectedVer && detectedVer !== '?' && detectedVer !== '에러(확인요망)' && detectedVer !== l.version) {
                    hasChanges = true;
                    return { ...l, version: detectedVer };
                }
                return l;
            });

            if (hasChanges) {
                // UI는 딜레이 없이 즉시 감지된 버전으로 갱신
                setLicenses(updatedLics);
                
                // 백그라운드에서 구글 시트에 비동기로 일괄 저장 (레이스 컨디션 전면 차단)
                (async () => {
                    const toSync = updatedLics.filter(l => {
                        const original = lics.find(o => o.id === l.id);
                        return original && original.version !== l.version;
                    });
                    if (toSync.length > 0) {
                        try {
                            await saveImpoLicensesBulk(toSync);
                        } catch (e) {
                            console.error('Failed to auto-sync versions in bulk to sheet:', e);
                        }
                    }
                })();
            }
        } catch (err) {
            console.error('Failed to load EzImpo data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredLicenses = useMemo(() => {
        return licenses.filter(l => {
            const searchStr = `${l.userName} ${l.companyName} ${l.key} ${l.contactInfo} ${l.machineId}`.toLowerCase();
            return searchStr.includes(searchTerm.toLowerCase());
        });
    }, [licenses, searchTerm]);

    const sortedLicenses = useMemo(() => {
        const items = [...filteredLicenses];
        if (sortConfig.key) {
            items.sort((a, b) => {
                if (sortConfig.key === 'version') {
                    // 버전 컬럼은 로그에서 감지된 최신 버전을 기준으로 정렬하여 UI와 일치시킵니다.
                    const vInfoA = getLicenseVersionInfo(a, installations, products, licenses, debugLogs);
                    const vInfoB = getLicenseVersionInfo(b, installations, products, licenses, debugLogs);
                    const verA = vInfoA.current || a.version || '0.0.0';
                    const verB = vInfoB.current || b.version || '0.0.0';
                    const cmp = compareVersions(verA, verB);
                    return sortConfig.direction === 'asc' ? cmp : -cmp;
                }

                const aVal = (a as any)[sortConfig.key] || '';
                const bVal = (b as any)[sortConfig.key] || '';
                
                // 문자열 비교 (기본)
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return items;
    }, [filteredLicenses, sortConfig, installations, debugLogs, products, licenses]);

    const filteredOfficial = useMemo(() => sortedLicenses.filter(l => l.type !== LicenseType.TRIAL && l.key !== 'TEST'), [sortedLicenses]);
    const filteredTrials = useMemo(() => sortedLicenses.filter(l => l.type === LicenseType.TRIAL || l.key === 'TEST'), [sortedLicenses]);

    const duplicateGroups = useMemo(() => getDuplicateGroups(licenses), [licenses]);

    const handleCleanDuplicates = async (idsToDelete: string[]) => {
        if (idsToDelete.length === 0) return;
        setIsCleaningUp(true);
        try {
            await deleteImpoLicensesBulk(idsToDelete);
            alert(`성공적으로 ${idsToDelete.length}개의 구버전 중복 라이선스를 정리했습니다!`);
            setShowCleanupModal(false);
            await loadAllData();
        } catch (err) {
            console.error('중복 정리 중 오류:', err);
            alert('중복 데이터를 정리하는 과정에서 오류가 발생했습니다.');
        } finally {
            setIsCleaningUp(false);
        }
    };

    const handleSaveLicense = async () => {
        setIsLoading(true);
        try {
            let expiresAt = newLicense.expiresAt;
            if (!isEditing || selectedDuration !== 'CURRENT') {
                const now = new Date();
                if (selectedDuration === '14DAYS') expiresAt = new Date(now.setDate(now.getDate() + 14)).toISOString();
                else if (selectedDuration === '30DAYS') expiresAt = new Date(now.setDate(now.getDate() + 30)).toISOString();
                else if (selectedDuration === '1YEAR') expiresAt = new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
                else if (selectedDuration === 'LIFETIME') expiresAt = '';
            }

            const licenseToSave = {
                ...newLicense,
                expiresAt,
                programId: PROGRAM_IDS.EZIMPO,
                type: activeTab === 'trials' ? LicenseType.TRIAL : LicenseType.SUBSCRIPTION
            } as License;

            await saveImpoLicense(licenseToSave);
            await loadAllData();
            setShowModal(false);
        } catch (err) {
            alert('라이선스 저장 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveProduct = async () => {
        setIsLoading(true);
        try {
            await saveImpoProduct({ ...newProduct, programId: PROGRAM_IDS.EZIMPO } as Product);
            await loadAllData();
            setShowModal(false);
        } catch (err) {
            alert('제품 저장 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    const promptDelete = (type: 'license' | 'product', id: string, name: string) => {
        setItemToDelete({ type, id, name });
        setShowConfirmModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        setIsLoading(true);
        try {
            if (itemToDelete.type === 'license') await deleteImpoLicense(itemToDelete.id);
            else await deleteImpoProduct(itemToDelete.id);
            await loadAllData();
            setShowConfirmModal(false);
        } catch (err) {
            alert('삭제 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetMachine = async (license: License) => {
        if (window.confirm('기기 ID를 초기화하시겠습니까?')) {
            await resetImpoMachineId(license.id);
            await loadAllData();
        }
    };

    const openSmsModal = (l: License) => {
        setSmsTarget({
            contact: l.contactInfo || '',
            content: '',
            licenseId: l.id
        });
        setModalType('sms');
        setShowModal(true);
    };

    const sendSms = async () => {
        if (!smsTarget.contact || !smsTarget.content) return alert('연락처와 내용을 입력해주세요.');
        setIsLoading(true);
        try {
            const success = await sendImpoSms(smsTarget.contact, smsTarget.content, smsTarget.licenseId);
            if (success) {
                alert('문자가 성공적으로 전송되었습니다.');
                setShowModal(false);
                loadAllData();
            } else {
                alert('문자 전송에 실패했습니다.');
            }
        } catch (err) {
            alert('문자 전송 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    const applyTemplate = (type: 'welcome' | 'upgrade') => {
        const l = licenses.find(lic => lic.id === smsTarget.licenseId);
        if (!l) return;
        
        let content = '';
        if (type === 'welcome') {
            content = `[EzImpo] 안녕하세요 ${l.userName}님, 라이선스가 발급되었습니다.\n\n- 제품: ${l.productName}\n- 키: ${l.key}\n- PIN: ${l.pin || '-'}\n- 만료일: ${l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '평생'}\n\n감사합니다.`;
        } else {
            content = `[EzImpo] 안녕하세요 ${l.userName}님, 새로운 버전이 출시되었습니다.\n\n프로그램을 재실행하여 업데이트를 진행해주세요.\n현재 버전: ${l.version}\n\n감사합니다.`;
        }
        setSmsTarget({ ...smsTarget, content });
    };

    const RenderTable = ({ data }: { data: License[] }) => (
        <table className="w-full text-left border-collapse table-fixed">
            <colgroup>
                <col style={{ width: '40px' }} />
                {COLUMN_DEFS.map(col => (
                    <col key={col.id} style={{ width: `${col.width}px` }} />
                ))}
            </colgroup>
            <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase sticky top-0 shadow-sm z-10">
                <tr>
                    <th className="px-3 py-2 text-center border-b">
                        <input type="checkbox" onChange={(e) => {
                            if (e.target.checked) setSelectedIds(new Set(data.map(d => d.id)));
                            else setSelectedIds(new Set());
                        }} />
                    </th>
                    {COLUMN_DEFS.map(col => (
                        <th 
                            key={col.id} 
                            className={`px-4 py-2 border-b text-center whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors ${col.id === 'version' ? 'bg-indigo-50/50' : ''}`}
                            onClick={() => {
                                const direction = sortConfig.key === col.id && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                                setSortConfig({ key: col.id as any, direction });
                            }}
                        >
                            <div className="flex items-center justify-center gap-1">
                                {col.label}
                                {sortConfig.key === col.id && (
                                    <i className={`fas fa-sort-amount-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[8px] text-indigo-500`}></i>
                                )}
                            </div>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {data.map((l, idx) => {
                    const isExpired = l.expiresAt && new Date(l.expiresAt) < new Date();
                    return (
                        <tr key={l.id} className={`hover:bg-indigo-50/30 transition-colors ${isExpired ? 'bg-red-50/30' : ''}`}>
                            <td className="px-3 py-1.5 text-center">
                                <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => {
                                    const next = new Set(selectedIds);
                                    if (next.has(l.id)) next.delete(l.id);
                                    else next.add(l.id);
                                    setSelectedIds(next);
                                }} />
                            </td>
                            <td className="px-4 py-1.5 text-center text-gray-400 text-xs truncate">{idx + 1}</td>
                            <td className="px-4 py-1.5 text-center text-xs font-mono font-bold text-indigo-600 truncate" title={l.key}>{l.key}</td>
                            <td className="px-4 py-1.5 text-center text-xs font-mono truncate">{l.pin || '-'}</td>
                            <td className="px-4 py-1.5 font-bold text-gray-900 truncate" title={l.userName}>{l.userName}</td>
                            <td className="px-4 py-1.5 text-gray-600 text-xs truncate" title={l.companyName}>{l.companyName || '-'}</td>
                            <td className="px-4 py-1.5 text-gray-600 text-xs text-center truncate font-mono">{l.contactInfo || '-'}</td>
                            <td className="px-4 py-1.5 text-gray-600 text-xs text-center truncate">{l.productName}</td>
                            <td className="px-4 py-1.5 font-mono text-[10px] text-center">
                                <div className="flex items-center justify-center gap-1 overflow-hidden">
                                    <span className="truncate" title={l.machineId}>{l.machineId || '-'}</span>
                                    {l.machineId && (
                                        <button onClick={() => handleResetMachine(l)} className="text-gray-300 hover:text-red-500 shrink-0" title="기기 초기화">
                                            <i className="fas fa-undo text-[8px]"></i>
                                        </button>
                                    )}
                                </div>
                            </td>
                            <td className="px-4 py-1.5 text-center text-[10px] text-blue-600 font-bold whitespace-nowrap">
                                {l.lastCheckIn ? new Date(l.lastCheckIn).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}
                            </td>
                            <td className="px-4 py-1.5 text-center text-[10px] text-gray-500 whitespace-nowrap">
                                {l.createdAt ? new Date(l.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}
                            </td>
                            <td className={`px-4 py-1.5 text-center text-xs whitespace-nowrap ${isExpired ? 'text-red-600 font-bold' : ''}`}>
                                {l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '평생'}
                            </td>
                            <td className="px-4 py-1.5 text-center whitespace-nowrap">
                                {(() => {
                                    const vInfo = getLicenseVersionInfo(l, installations, products, licenses, debugLogs);
                                    const isOutdated = vInfo.status === 'OUTDATED';
                                    const displayVer = vInfo.current && vInfo.current !== '?' ? vInfo.current : (l.version || 'v?');
                                    
                                    return (
                                        <div className="flex items-center justify-center gap-1 group/ver relative whitespace-nowrap">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                                                isOutdated ? 'bg-red-50 text-red-700 border-red-200 animate-pulse' : 
                                                vInfo.status === 'LATEST' ? 'bg-green-50 text-green-700 border-green-200' :
                                                'bg-blue-50 text-blue-700 border-blue-100'
                                            }`}>
                                                {displayVer}
                                            </span>
                                            {vInfo.isSuspicious && (
                                                <i className="fas fa-exclamation-triangle text-amber-500 text-[10px] shrink-0" title="의존성 버전(3.7.0)이 감지되었습니다. 클라이언트 보고 오류일 수 있습니다."></i>
                                            )}

                                            {/* Tooltip for detailed info */}
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-[9px] rounded-lg opacity-0 pointer-events-none group-hover/ver:opacity-100 transition-opacity z-50 shadow-xl">
                                                <p className="font-bold border-b border-white/10 pb-1 mb-1">버전 상세 분석</p>
                                                <p>• 시트 기록: {l.version || '-'}</p>
                                                <p>• 로그 감지: {vInfo.current}</p>
                                                <p>• 제품 최신: {vInfo.latest}</p>
                                                {vInfo.detectedMachineId && (
                                                    <p className="mt-1 pt-1 border-t border-white/10 text-indigo-300">
                                                        실제 기기: {vInfo.detectedMachineId.substring(0, 12)}...
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </td>
                            <td className="px-4 py-1.5 text-center whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    l.status === LicenseStatus.ACTIVE ? 'bg-green-100 text-green-700' : 
                                    l.status === LicenseStatus.EXPIRED ? 'bg-red-100 text-red-700' :
                                    'bg-orange-100 text-orange-700'
                                }`}>
                                    {l.status === LicenseStatus.ACTIVE ? '활성' : l.status === LicenseStatus.EXPIRED ? '만료' : '대기'}
                                </span>
                            </td>
                            <td className="px-4 py-1.5 text-center whitespace-nowrap">
                                <div className="flex justify-center gap-2">
                                    <button onClick={() => openSmsModal(l)} className="text-green-600 hover:text-green-800" title="문자 보내기"><i className="fas fa-comment-dots"></i></button>
                                    <button onClick={() => {
                                        setModalType('license');
                                        setIsEditing(true);
                                        setNewLicense(l);
                                        setSelectedDuration('CURRENT');
                                        setShowModal(true);
                                    }} className="text-gray-400 hover:text-indigo-600"><i className="fas fa-edit"></i></button>
                                    <button onClick={() => promptDelete('license', l.id, l.key)} className="text-gray-400 hover:text-red-600"><i className="fas fa-trash"></i></button>
                                </div>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );

    return (
        <div className="flex flex-col h-[calc(100vh-180px)] bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
            {/* Header Toolbar */}
            <div className="bg-white p-3 border-b flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <i className="fas fa-print text-indigo-600"></i> EzImpo 라이선스
                    </h2>
                    <div className="flex bg-gray-100 p-0.5 rounded-lg">
                        <button onClick={() => setActiveTab('licenses')} className={`px-4 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'licenses' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>정식 ({filteredOfficial.length})</button>
                        <button onClick={() => setActiveTab('trials')} className={`px-4 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'trials' ? 'bg-white shadow text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}>체험판 ({filteredTrials.length})</button>
                        <button onClick={() => setActiveTab('products')} className={`px-4 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'products' ? 'bg-white shadow text-amber-600' : 'text-gray-500 hover:text-gray-700'}`}>제품 ({products.length})</button>
                        <button onClick={() => setActiveTab('versions')} className={`px-4 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'versions' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}>버전</button>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input 
                            type="text" 
                            placeholder="고객명, 키, 연락처 검색..." 
                            className="w-full pl-9 pr-4 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {duplicateGroups.length > 0 && (
                        <button 
                            onClick={() => setShowCleanupModal(true)}
                            className="bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 animate-pulse"
                            title="중복 감지됨: 클릭하여 정리하기"
                        >
                            <i className="fas fa-exclamation-triangle"></i>
                            중복 정리 ({duplicateGroups.length}건)
                        </button>
                    )}
                    <button 
                        onClick={() => {
                            if (activeTab === 'products') {
                                setModalType('product');
                                setNewProduct({ name: '', version: '', price: 0 });
                            } else {
                                setModalType('license');
                                setNewLicense({
                                    programId: PROGRAM_IDS.EZIMPO,
                                    key: generateSerialKey('EZIM'),
                                    status: LicenseStatus.ACTIVE,
                                    paymentStatus: 'PAID',
                                    userName: '',
                                    companyName: '',
                                    contactInfo: '',
                                    productId: products.length > 0 ? products[0].id : '',
                                    productName: products.length > 0 ? products[0].name : '',
                                    type: activeTab === 'trials' ? LicenseType.TRIAL : LicenseType.SUBSCRIPTION
                                });
                                setSelectedDuration(activeTab === 'trials' ? '14DAYS' : 'LIFETIME');
                            }
                            setIsEditing(false);
                            setShowModal(true);
                        }}
                        className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:bg-indigo-700 flex items-center gap-2"
                    >
                        <i className="fas fa-plus"></i> 추가
                    </button>
                    <button onClick={loadAllData} className="p-2 text-gray-400 hover:text-indigo-600 transition-colors" title="새로고침">
                        <i className={`fas fa-sync-alt ${isLoading ? 'animate-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto bg-white">
                {activeTab === 'products' ? (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase sticky top-0 shadow-sm z-10">
                            <tr>
                                {['name', 'version', 'price'].map(key => (
                                    <th 
                                        key={key} 
                                        className={`px-6 py-2 border-b cursor-pointer hover:bg-gray-100 transition-colors ${key !== 'name' ? 'text-center' : ''}`}
                                        onClick={() => {
                                            const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
                                            setSortConfig({ key: key as any, direction });
                                        }}
                                    >
                                        <div className={`flex items-center gap-1 ${key !== 'name' ? 'justify-center' : ''}`}>
                                            {key === 'name' ? '제품명' : key === 'version' ? '버전' : '가격'}
                                            {sortConfig.key === key && (
                                                <i className={`fas fa-sort-amount-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[8px] text-indigo-500`}></i>
                                            )}
                                        </div>
                                    </th>
                                ))}
                                <th className="px-6 py-2 border-b text-center">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {[...products].sort((a, b) => {
                                const aVal = (a as any)[sortConfig.key] || '';
                                const bVal = (b as any)[sortConfig.key] || '';
                                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                                return 0;
                            }).map(p => (
                                <tr key={p.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3 font-bold text-gray-800">{p.name}</td>
                                    <td className="px-6 py-3 text-center font-mono text-sm">{p.version}</td>
                                    <td className="px-6 py-3 text-center text-gray-600">{p.price.toLocaleString()}원</td>
                                    <td className="px-6 py-3 text-center">
                                        <div className="flex justify-center gap-3">
                                            <button onClick={() => {
                                                setModalType('product');
                                                setIsEditing(true);
                                                setNewProduct(p);
                                                setShowModal(true);
                                            }} className="text-gray-400 hover:text-indigo-600"><i className="fas fa-edit"></i></button>
                                            <button onClick={() => promptDelete('product', p.id, p.name)} className="text-gray-400 hover:text-red-600"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : activeTab === 'versions' ? (
                    <div className="flex h-full bg-gray-50/50 p-6 gap-6 overflow-hidden">
                        {/* Left: Need Update */}
                        <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
                            <div className="p-4 bg-orange-50 border-b border-orange-100 flex justify-between items-center">
                                <h3 className="font-bold text-orange-700 flex items-center gap-2">
                                    <i className="fas fa-bolt"></i> 업데이트 필요 ({licenses.filter(l => {
                                        const p = products.find(prod => prod.id === l.productId);
                                        return p && l.version && l.version !== p.version;
                                    }).length})
                                </h3>
                                <span className="text-[10px] font-bold text-orange-600 bg-white px-2 py-0.5 rounded-full shadow-sm">즉시 배포 가능</span>
                            </div>
                            <div className="flex-1 overflow-auto p-4 space-y-3">
                                {licenses.filter(l => {
                                    const p = products.find(prod => prod.id === l.productId);
                                    return p && l.version && l.version !== p.version;
                                }).map(l => {
                                    const p = products.find(prod => prod.id === l.productId);
                                    return (
                                        <div key={l.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl hover:shadow-md transition-all group">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                                    <i className="fas fa-user-circle text-gray-300"></i> {l.userName}
                                                </span>
                                                <span className="text-[10px] text-gray-400">{l.productName} / {l.companyName || '-'}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-2 font-mono text-xs">
                                                    <span className="text-red-500 font-bold">{l.version}</span>
                                                    <i className="fas fa-long-arrow-alt-right text-gray-300"></i>
                                                    <span className="text-green-600 font-bold">{p?.version}</span>
                                                </div>
                                                <button onClick={() => openSmsModal(l)} className="px-3 py-1 bg-orange-500 text-white text-[10px] font-bold rounded-lg hover:bg-orange-600 shadow-sm transition-colors">문자</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right: Up to Date */}
                        <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-green-100 overflow-hidden">
                            <div className="p-4 bg-green-50 border-b border-green-100 flex justify-between items-center">
                                <h3 className="font-bold text-green-700 flex items-center gap-2">
                                    <i className="fas fa-check-circle"></i> 최신 버전 사용 중 ({licenses.filter(l => {
                                        const p = products.find(prod => prod.id === l.productId);
                                        return p && l.version === p.version;
                                    }).length})
                                </h3>
                                <i className="fas fa-shield-alt text-green-400"></i>
                            </div>
                            <div className="flex-1 overflow-auto p-4 space-y-2">
                                {licenses.filter(l => {
                                    const p = products.find(prod => prod.id === l.productId);
                                    return p && l.version === p.version;
                                }).map(l => (
                                    <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50/50 border border-gray-100 rounded-xl">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-gray-700 text-xs">{l.userName}</span>
                                            <span className="text-[9px] text-gray-400">{l.productName}</span>
                                        </div>
                                        <span className="text-[10px] font-mono font-bold text-green-600 bg-white px-2 py-0.5 rounded border border-green-100">{l.version}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : activeTab === 'trials' ? (
                    <RenderTable data={filteredTrials} />
                ) : (
                    <RenderTable data={filteredOfficial} />
                )}
            </div>

            {/* Footer / Pagination Placeholder */}
            <div className="bg-white border-t p-2 flex justify-between items-center text-[10px] text-gray-400">
                <div>Total: {activeTab === 'products' ? products.length : (activeTab === 'trials' ? filteredTrials.length : filteredOfficial.length)} items</div>
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <button className="text-red-500 font-bold hover:underline">선택 삭제 ({selectedIds.size})</button>
                    )}
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-800">
                                {modalType === 'license' ? (isEditing ? '라이선스 수정' : '신규 라이선스 발급') : 
                                 modalType === 'product' ? '제품 정보 설정' : '문자 메시지 전송'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                        </div>
                        
                        <div className="p-6 max-h-[80vh] overflow-y-auto">
                            {modalType === 'license' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">고객명</label>
                                            <input type="text" className="w-full border rounded-lg p-2 text-sm" value={newLicense.userName} onChange={e => setNewLicense({...newLicense, userName: e.target.value})} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">회사명</label>
                                            <input type="text" className="w-full border rounded-lg p-2 text-sm" value={newLicense.companyName} onChange={e => setNewLicense({...newLicense, companyName: e.target.value})} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">연락처</label>
                                            <input type="text" className="w-full border rounded-lg p-2 text-sm" placeholder="010-0000-0000" value={newLicense.contactInfo} onChange={e => setNewLicense({...newLicense, contactInfo: formatContactInput(e.target.value)})} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">제품 선택</label>
                                            <select className="w-full border rounded-lg p-2 text-sm font-bold bg-blue-50 border-blue-200" value={newLicense.productId} onChange={e => {
                                                const p = products.find(prod => prod.id === e.target.value);
                                                setNewLicense({...newLicense, productId: e.target.value, productName: p?.name || '', version: p?.version || ''});
                                            }}>
                                                <option value="">-- 선택 --</option>
                                                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">라이선스 키</label>
                                            <div className="flex gap-2">
                                                <input type="text" className="flex-1 border rounded-lg p-2 text-sm font-mono font-bold text-indigo-600" value={newLicense.key} onChange={e => setNewLicense({...newLicense, key: e.target.value.toUpperCase()})} />
                                                {!isEditing && <button onClick={() => setNewLicense({...newLicense, key: generateSerialKey('EZIM')})} className="px-3 bg-gray-100 rounded-lg text-xs"><i className="fas fa-sync-alt"></i></button>}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">PIN (선택)</label>
                                            <input type="text" className="w-full border rounded-lg p-2 text-sm font-bold" value={newLicense.pin} onChange={e => setNewLicense({...newLicense, pin: e.target.value})} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 border-t pt-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">상태</label>
                                            <select className="w-full border rounded-lg p-2 text-sm" value={newLicense.status} onChange={e => setNewLicense({...newLicense, status: e.target.value as any})}>
                                                <option value="ACTIVE">활성</option>
                                                <option value="PENDING">대기</option>
                                                <option value="EXPIRED">만료</option>
                                                <option value="REVOKED">정지</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">결제 상태</label>
                                            <select className="w-full border rounded-lg p-2 text-sm" value={newLicense.paymentStatus} onChange={e => setNewLicense({...newLicense, paymentStatus: e.target.value as any})}>
                                                <option value="PAID">완료</option>
                                                <option value="UNPAID">미결제</option>
                                                <option value="FREE">무료</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">유효 기간</label>
                                            <select className="w-full border rounded-lg p-2 text-sm bg-amber-50 border-amber-200 font-bold" value={selectedDuration} onChange={e => setSelectedDuration(e.target.value)}>
                                                {isEditing && <option value="CURRENT">기존 유지</option>}
                                                <option value="14DAYS">+14일</option>
                                                <option value="30DAYS">+30일</option>
                                                <option value="1YEAR">+1년</option>
                                                <option value="LIFETIME">평생</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {modalType === 'product' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">제품명</label>
                                        <input type="text" className="w-full border rounded-lg p-2 text-sm" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">기본 버전</label>
                                            <input type="text" className="w-full border rounded-lg p-2 text-sm font-mono" placeholder="1.0.0" value={newProduct.version} onChange={e => setNewProduct({...newProduct, version: e.target.value})} />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">가격 (원)</label>
                                            <input type="number" className="w-full border rounded-lg p-2 text-sm" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: Number(e.target.value)})} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {modalType === 'sms' && (
                                <div className="space-y-4">
                                    <div className="flex gap-2 p-2 bg-gray-50 rounded-lg border border-dashed">
                                        <button onClick={() => applyTemplate('welcome')} className="flex-1 py-1.5 bg-white border border-gray-200 rounded text-[11px] font-bold hover:bg-gray-50 transition-colors">라이선스 발급 안내</button>
                                        <button onClick={() => applyTemplate('upgrade')} className="flex-1 py-1.5 bg-white border border-gray-200 rounded text-[11px] font-bold hover:bg-gray-50 transition-colors">업데이트 공지</button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">수신 번호</label>
                                        <input type="text" className="w-full border rounded-lg p-2 text-sm bg-gray-50" value={smsTarget.contact} readOnly />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">내용 (SMS/LMS 자동 전환)</label>
                                        <textarea 
                                            className="w-full border rounded-lg p-3 text-sm h-48 focus:ring-2 focus:ring-indigo-500 outline-none resize-none" 
                                            value={smsTarget.content} 
                                            onChange={e => setSmsTarget({...smsTarget, content: e.target.value})}
                                        />
                                        <div className="mt-1 text-right text-[10px] text-gray-400">
                                            {smsTarget.content.length} 자 / 약 {Math.ceil(smsTarget.content.length / 80)} 건 발송
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 bg-gray-50 border-t flex gap-3">
                            <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all">취소</button>
                            <button 
                                onClick={modalType === 'sms' ? sendSms : (modalType === 'product' ? handleSaveProduct : handleSaveLicense)} 
                                disabled={isLoading}
                                className="flex-[2] py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:bg-gray-400 transition-all"
                            >
                                {isLoading ? '처리 중...' : (modalType === 'sms' ? '문자 보내기' : '저장하기')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Modal */}
            {showConfirmModal && itemToDelete && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000] p-4" onClick={() => setShowConfirmModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                            <i className="fas fa-exclamation-triangle"></i>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">정말 삭제하시겠습니까?</h3>
                        <p className="py-4 text-sm text-gray-500">"{itemToDelete.name}" 정보를 영구적으로 삭제합니다.<br/>이 작업은 되돌릴 수 없습니다.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowConfirmModal(false)} className="flex-1 bg-gray-100 py-2.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-200 transition-all">취소</button>
                            <button onClick={confirmDelete} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-red-100 hover:bg-red-700 transition-all">삭제하기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Duplicate Cleanup Modal */}
            {showCleanupModal && duplicateGroups.length > 0 && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10000] p-4" onClick={() => setShowCleanupModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="px-6 py-4 border-b flex justify-between items-center bg-amber-50 rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <span className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                                    <i className="fas fa-magic"></i>
                                </span>
                                <div>
                                    <h3 className="text-base font-bold text-amber-900">중복 라이선스 정리 도우미</h3>
                                    <p className="text-[10px] text-amber-700">이름과 연락처가 동일한 중복 라이선스를 감지하여 최신 기록만 보존하고 이전 쓰레기 데이터를 자동 삭제합니다.</p>
                                </div>
                            </div>
                            <button onClick={() => setShowCleanupModal(false)} className="text-gray-400 hover:text-gray-600">
                                <i className="fas fa-times text-lg"></i>
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-gray-50/50">
                            {duplicateGroups.map((g, idx) => {
                                const keepLics = g.keepLicenses;
                                const deleteLics = g.deleteLicenses;
                                
                                return (
                                    <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                                        <div className="px-4 py-2.5 bg-slate-800 text-white flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-extrabold text-amber-400 bg-white/10 px-2 py-0.5 rounded">그룹 {idx + 1}</span>
                                                <span className="text-sm font-bold">{g.userName} 부장/대표 ({g.companyName || '상호미상'})</span>
                                                <span className="text-xs text-gray-300 font-mono">{g.contactInfo}</span>
                                            </div>
                                            <button 
                                                onClick={() => handleCleanDuplicates(deleteLics.map(l => l.id))}
                                                disabled={isCleaningUp}
                                                className="bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-slate-900 px-3 py-1 rounded text-xs font-bold transition-all"
                                            >
                                                이 그룹 구버전 정리 ({deleteLics.length}건 삭제)
                                            </button>
                                        </div>

                                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* 보존할 최신 라이선스 */}
                                            <div className="border border-green-200 rounded-lg p-3 bg-green-50/20 relative space-y-3">
                                                <span className="absolute top-3 right-3 text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded border border-green-200">보존 대상 ({keepLics.length}건)</span>
                                                <h4 className="text-xs font-bold text-green-800 mb-2">⭐ 최근 기기 및 접속 기록 (보존)</h4>
                                                {keepLics.map((keepLic) => (
                                                    <div key={keepLic.id} className="text-[11px] text-gray-600 space-y-1 border-t border-green-200/50 pt-2 first:border-0 first:pt-0">
                                                        <p>• 라이선스 키: <span className="font-mono font-bold text-slate-700">{keepLic.key}</span></p>
                                                        <p>• 기기 ID: <span className="font-mono text-gray-500">{keepLic.machineId || '기기 등록 전'}</span></p>
                                                        <p>• 최근 접속일: <span className="font-bold text-blue-600">{keepLic.lastCheckIn ? new Date(keepLic.lastCheckIn).toLocaleString() : '접속 기록 없음'}</span></p>
                                                        <p>• 등록일: <span>{keepLic.createdAt ? new Date(keepLic.createdAt).toLocaleString() : '-'}</span></p>
                                                        <p>• 기간: <span className="font-bold text-gray-700">{keepLic.expiresAt ? new Date(keepLic.expiresAt).toLocaleDateString() : '평생'}</span></p>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* 삭제할 중복 라이선스들 */}
                                            <div className="border border-red-100 rounded-lg p-3 bg-red-50/10 space-y-3">
                                                <h4 className="text-xs font-bold text-red-800">🗑️ 삭제 예정 (과거 구버전 기록)</h4>
                                                {deleteLics.map((dl, dIdx) => (
                                                    <div key={dl.id} className="text-[11px] text-gray-500 border-t border-red-200/50 pt-2 first:border-0 first:pt-0">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className="font-bold text-red-600">삭제 대상 #{dIdx + 1}</span>
                                                            <span className="text-[9px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-100">삭제</span>
                                                        </div>
                                                        <div className="space-y-0.5">
                                                            <p>• 라이선스 키: <span className="font-mono">{dl.key}</span></p>
                                                            <p>• 기기 ID: <span className="font-mono">{dl.machineId || '기기 등록 전'}</span></p>
                                                            <p>• 최근 접속일: <span className="font-bold text-gray-600">{dl.lastCheckIn ? new Date(dl.lastCheckIn).toLocaleString() : '접속 기록 없음'}</span></p>
                                                            <p>• 등록일: <span>{dl.createdAt ? new Date(dl.createdAt).toLocaleString() : '-'}</span></p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t flex justify-between items-center">
                            <span className="text-xs text-slate-500 font-medium">총 {duplicateGroups.length}개 그룹, 삭제 예정 데이터 {duplicateGroups.reduce((acc, g) => acc + g.deleteLicenses.length, 0)}건 감지됨</span>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowCleanupModal(false)}
                                    className="px-5 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all"
                                >
                                    닫기
                                </button>
                                <button 
                                    onClick={() => {
                                        const allDeleteIds = duplicateGroups.flatMap(g => g.deleteLicenses.map(l => l.id));
                                        if (confirm(`정말로 감지된 총 ${allDeleteIds.length}개의 구버전/중복 데이터를 일괄 삭제하시겠습니까?\n(정상 활성 라이선스는 보존됩니다)`)) {
                                            handleCleanDuplicates(allDeleteIds);
                                        }
                                    }}
                                    disabled={isCleaningUp}
                                    className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-100 transition-all flex items-center gap-1.5"
                                >
                                    {isCleaningUp ? '일괄 정리 중...' : (
                                        <>
                                            <i className="fas fa-trash-alt"></i>
                                            원클릭 전체 중복 자동 정리
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EzImpoLicenseManager;
