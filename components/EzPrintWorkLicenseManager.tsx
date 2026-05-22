import React, { useState, useEffect, useMemo } from 'react';
import { 
  PROGRAM_IDS, 
  License, 
  LicenseStatus, 
  LicenseType 
} from '../types';
import { 
  getPrintWorkLicenses, 
  savePrintWorkLicense, 
  deletePrintWorkLicense, 
  deletePrintWorkLicensesBulk,
  syncPrintWorkStructure,
  generateFullDatabaseBackup,
  restoreFullDatabaseFromBackup,
  runDailyAutoBackup,
  fetchGoogleDriveBackups,
  fetchBackupContentFromDrive,
  removeBackupFromDrive
} from '../services/ezPrintWorkService';
import { formatContactInput } from '../utils/helpers';
import { getAllTenants, getAllWebUsers, syncWebUserRole, findWebUserByEmail, deleteWebTenantAndUsers, deleteWebUser, deleteWebTenantDirect, deleteWebUserDirect } from '../services/firebaseBridge';
import { Tenant, AppUser } from '../types';

const PLAN_DEFS = {
  ad: { label: '광고형', max: 1, color: 'bg-gray-100 text-gray-600' },
  u3: { label: '3인 사용', max: 3, color: 'bg-blue-100 text-blue-700' },
  u5: { label: '5인 사용', max: 5, color: 'bg-indigo-100 text-indigo-700' },
  u10: { label: '10인 사용', max: 10, color: 'bg-purple-100 text-purple-700' },
  service: { label: '무료 사용자', max: 999, color: 'bg-amber-100 text-amber-700' },
};

const EzPrintWorkLicenseManager: React.FC = () => {
    const [licenses, setLicenses] = useState<License[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    
    // [NEW] Firebase Data
    const [webTenants, setWebTenants] = useState<Tenant[]>([]);
    const [webUsers, setWebUsers] = useState<AppUser[]>([]);
    const [isSyncingWeb, setIsSyncingWeb] = useState(false);
    
    // [NEW] Auto-Import states for Route B background worker
    const autoImportingEmailsRef = React.useRef<Set<string>>(new Set());
    const [autoImportNotifications, setAutoImportNotifications] = useState<{ id: string, message: string }[]>([]);
    
    // Modal states
    const [showModal, setShowModal] = useState(false);
    
    // [NEW] Backup & Recovery states
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [backupList, setBackupList] = useState<{ id: string, name: string, createdTime: string, size?: string }[]>([]);
    const [isBackupLoading, setIsBackupLoading] = useState(false);
    const [backupStatusMessage, setBackupStatusMessage] = useState('');

    const [modalType, setModalType] = useState<'group' | 'member'>('group');
    const [isEditing, setIsEditing] = useState(false);
    const [targetGroup, setTargetGroup] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState<{ groupAdmin: License | null, members: License[], companyName: string, webTenant: Tenant | null } | null>(null);
    const [newLicense, setNewLicense] = useState<Partial<License>>({
        status: LicenseStatus.ACTIVE,
        plan: 'ad',
        role: 'ADMIN',
        programId: PROGRAM_IDS.EZPRINTWORK
    });

    const mouseDownTargetRef = React.useRef<EventTarget | null>(null);

    const loadWebData = async () => {
        try {
            const tenants = await getAllTenants();
            setWebTenants(tenants);
            const users = await getAllWebUsers();
            setWebUsers(users);
        } catch (e) {
            console.error("Failed to load web tenants/users:", e);
        }
    };

    const loadData = async (force = false) => {
        setIsLoading(true);
        try {
            const data = await getPrintWorkLicenses(force);
            setLicenses(data);
        } catch (e) {
            console.error("Failed to load sheet data:", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { 
        loadData(true); 
        loadWebData();
    }, []);

    const unifiedGroups = useMemo(() => {
        const groups: Record<string, { 
            admin: License | null, 
            members: License[], 
            companyName: string, 
            webTenant: Tenant | null,
            isWebOnly: boolean 
        }> = {};
        
        licenses.forEach(l => {
            const adminEmail = l.adminEmail || l.email;
            const companyName = l.companyName || '미지정 회사';
            const groupKey = `${adminEmail}_${companyName}`;

            if (!groups[groupKey]) {
                groups[groupKey] = { admin: null, members: [], companyName: companyName, webTenant: null, isWebOnly: false };
            }
            
            if (l.role === 'ADMIN' || (l.email === adminEmail && !groups[groupKey].admin)) {
                groups[groupKey].admin = l;
                groups[groupKey].companyName = companyName;
                if ((l as any).isWebOnly) {
                    groups[groupKey].isWebOnly = true;
                }
            } else {
                groups[groupKey].members.push(l);
            }
        });

        webTenants.forEach(t => {
            const ownerUser = webUsers.find(u => u.uid === t.ownerId || (u.tenantId === t.id && u.role === 'admin'));
            const ownerEmail = (ownerUser?.email || t.ownerId || '').trim().toLowerCase();
            let matched = false;

            Object.entries(groups).forEach(([key, data]) => {
                const adminEmail = (data.admin?.adminEmail || data.admin?.email || '').trim().toLowerCase();
                if (adminEmail === ownerEmail && ownerEmail !== '') {
                    data.webTenant = t;
                    matched = true;
                }
            });

            if (!matched && ownerEmail !== '') {
                const webKey = `web_${ownerEmail}_${t.name}`;
                groups[webKey] = {
                    admin: {
                        id: `web-${t.id}`,
                        adminEmail: ownerEmail,
                        email: ownerEmail,
                        userName: ownerUser?.displayName || ownerUser?.userName || '웹 가입자',
                        companyName: t.name,
                        plan: t.plan === 'pro_plus' ? 'service' : (t.plan === 'free' ? 'ad' : t.plan),
                        paymentStatus: 'UNPAID',
                        role: 'ADMIN',
                        status: LicenseStatus.ACTIVE,
                        programId: PROGRAM_IDS.EZPRINTWORK,
                        createdAt: t.createdAt || new Date().toISOString()
                    } as any,
                    members: [],
                    companyName: t.name,
                    webTenant: t,
                    isWebOnly: true
                };
            }
        });

        return Object.entries(groups)
            .filter(([_, data]) => {
                if (!searchTerm) return true;
                const searchStr = `${data.companyName} ${data.admin?.email || ''} ${data.admin?.userName || ''}`.toLowerCase();
                return searchStr.includes(searchTerm.toLowerCase());
            })
            .sort((a, b) => a[1].companyName.localeCompare(b[1].companyName));
    }, [licenses, webTenants, webUsers, searchTerm]);

    const sortedGroups = useMemo(() => {
        const items = [...unifiedGroups];
        if (!sortConfig) return items;

        items.sort((a, b) => {
            const dataA = a[1];
            const dataB = b[1];

            let valA: any = '';
            let valB: any = '';

            if (sortConfig.key === 'createdAt') {
                valA = dataA.admin?.createdAt ? new Date(dataA.admin.createdAt).getTime() : 0;
                valB = dataB.admin?.createdAt ? new Date(dataB.admin.createdAt).getTime() : 0;
            } else if (sortConfig.key === 'companyName') {
                valA = dataA.companyName || '';
                valB = dataB.companyName || '';
            } else if (sortConfig.key === 'userName') {
                valA = dataA.admin?.userName || '';
                valB = dataB.admin?.userName || '';
            } else if (sortConfig.key === 'adminEmail') {
                valA = dataA.admin?.adminEmail || dataA.admin?.email || '';
                valB = dataB.admin?.adminEmail || dataB.admin?.email || '';
            } else if (sortConfig.key === 'businessNumber') {
                valA = dataA.admin?.businessNumber || '';
                valB = dataB.admin?.businessNumber || '';
            } else if (sortConfig.key === 'joinCode') {
                valA = dataA.admin?.joinCode || '';
                valB = dataB.admin?.joinCode || '';
            } else if (sortConfig.key === 'contactInfo') {
                valA = dataA.admin?.contactInfo || '';
                valB = dataB.admin?.contactInfo || '';
            } else if (sortConfig.key === 'plan') {
                valA = PLAN_DEFS[dataA.admin?.plan as keyof typeof PLAN_DEFS]?.label || '';
                valB = PLAN_DEFS[dataB.admin?.plan as keyof typeof PLAN_DEFS]?.label || '';
            } else if (sortConfig.key === 'paymentStatus') {
                valA = dataA.admin?.paymentStatus || '';
                valB = dataB.admin?.paymentStatus || '';
            } else if (sortConfig.key === 'expiresAt') {
                valA = dataA.admin?.expiresAt ? new Date(dataA.admin.expiresAt).getTime() : 0;
                valB = dataB.admin?.expiresAt ? new Date(dataB.admin.expiresAt).getTime() : 0;
            } else if (sortConfig.key === 'webTenant') {
                const getSyncStatus = (g: typeof dataA) => {
                    if (g.isWebOnly) return 1;
                    if (g.webTenant) return 2;
                    return 3;
                };
                valA = getSyncStatus(dataA);
                valB = getSyncStatus(dataB);
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [unifiedGroups, sortConfig]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const renderSortIcon = (key: string) => {
        if (!sortConfig || sortConfig.key !== key) {
            return <i className="fas fa-sort text-gray-300 text-[8px] ml-1"></i>;
        }
        return (
            <i className={`fas fa-sort-amount-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[8px] text-green-600 ml-1`}></i>
        );
    };

    const ghostTenants = useMemo(() => {
        if (isLoading || licenses.length === 0 || webTenants.length === 0) return [];
        const activeAdminEmails = new Set(licenses.map(l => (l.adminEmail || l.email || '').trim().toLowerCase()));
        return webTenants.filter(t => {
            const ownerUser = webUsers.find(u => u.uid === t.ownerId || (u.tenantId === t.id && u.role === 'admin'));
            const ownerEmail = (ownerUser?.email || t.ownerId || '').trim().toLowerCase();
            return ownerEmail !== '' && !activeAdminEmails.has(ownerEmail);
        });
    }, [licenses, webTenants, webUsers, isLoading]);

    const toggleGroup = (groupKey: string) => {
        const next = new Set(expandedGroups);
        if (next.has(groupKey)) next.delete(groupKey);
        else next.add(groupKey);
        setExpandedGroups(next);
    };

    const handleSyncToWeb = async (adminEmail: string, plan: string, expiresAt: string | null) => {
        if (!window.confirm(`${adminEmail}의 정보를 웹(Firebase)으로 동기화하시겠습니까?`)) return;
        
        setIsSyncingWeb(true);
        try {
            const targetLic = licenses.find(l => (l.adminEmail === adminEmail || l.email === adminEmail) && l.role === 'ADMIN');
            const webPlan = plan === 'service' ? 'pro_plus' : (plan === 'ad' ? 'free' : plan) as any;
            await syncWebUserRole(
                adminEmail, 
                webPlan, 
                expiresAt || undefined,
                targetLic?.joinCode,
                targetLic?.companyName,
                targetLic?.businessNumber,
                adminEmail
            );
            alert('웹 동기화 성공!');
            await loadWebData();
        } catch (e) {
            alert('웹 동기화 실패: 사용자가 아직 웹에서 가입하지 않았거나 오류가 발생했습니다.');
        } finally {
            setIsSyncingWeb(false);
        }
    };

    const handleImportTenantToSheet = async (tenant: Tenant) => {
        if (!window.confirm(`웹 가입자 [${tenant.name}] (${tenant.ownerId})의 정보를 구글 시트 라이선스 목록에 추가하시겠습니까?`)) return;
        
        setIsLoading(true);
        try {
            const currentLics = await getPrintWorkLicenses(true);
            const exists = currentLics.some(l => l.email === tenant.ownerId || l.adminEmail === tenant.ownerId);
            
            if (exists) {
                alert('이미 구글 시트에 등록된 이메일 계정입니다.');
                setIsLoading(false);
                return;
            }

            let userName = '웹 가입자';
            try {
                const userMatch = await findWebUserByEmail(tenant.ownerId);
                if (userMatch && userMatch.user) {
                    userName = userMatch.user.displayName || userMatch.user.userName || userName;
                }
            } catch (e) {
                console.warn("Failed to find web user details:", e);
            }

            const joinCode = (tenant as any).joinCode || 'temp' + Math.floor(1000 + Math.random() * 9000);
            const businessNumber = (tenant as any).businessNumber || '';

            const newLic: License = {
                adminEmail: tenant.ownerId,
                email: tenant.ownerId,
                key: tenant.ownerId,
                password: 'temp' + Math.floor(1000 + Math.random() * 9000),
                userName: userName,
                position: '대표자',
                role: 'ADMIN',
                companyName: tenant.name,
                plan: tenant.plan === 'pro_plus' ? 'service' : (tenant.plan === 'free' ? 'ad' : tenant.plan),
                paymentStatus: 'UNPAID',
                joinCode: joinCode,
                businessNumber: businessNumber,
                expiresAt: tenant.licenseExpiresAt || null,
                createdAt: tenant.createdAt || new Date().toISOString(),
                status: LicenseStatus.ACTIVE,
                programId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION
            } as unknown as License;

            await savePrintWorkLicense(newLic);

            try {
                const webPlan = newLic.plan === 'service' ? 'pro_plus' : (newLic.plan === 'ad' ? 'free' : newLic.plan) as any;
                await syncWebUserRole(
                    tenant.ownerId, 
                    webPlan, 
                    newLic.expiresAt || undefined,
                    joinCode,
                    tenant.name,
                    businessNumber,
                    tenant.ownerId
                );
            } catch (e) {
                console.warn("Manual import Firebase sync failed:", e);
            }

            alert(`[${tenant.name}] 그룹이 구글 시트에 신규 등록되었습니다!`);
            await loadData(true);
            await loadWebData();
        } catch (e) {
            console.error(e);
            alert('구글 시트 등록 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    // [NEW] Background Auto-Onboarding for Route B (Web-Only) tenants
    const autoImportTenantToSheetSilent = async (tenant: Tenant) => {
        // [Safe Isolation] Find actual owner user email to avoid raw Firebase UID as email
        const ownerUser = webUsers.find(u => u.uid === tenant.ownerId || (u.tenantId === tenant.id && u.role === 'admin'));
        const ownerEmail = (ownerUser?.email || tenant.ownerId || '').trim().toLowerCase();
        
        if (!ownerEmail || !ownerEmail.includes('@')) return;

        // Skip temporary or system test accounts completely
        const isTempHubEmail = ownerEmail.endsWith('@ez-hub.kr') || ownerEmail.includes('ez-hub') || ownerEmail.startsWith('user-');
        if (isTempHubEmail) {
            return;
        }

        // Concurrency block using Ref
        if (autoImportingEmailsRef.current.has(ownerEmail)) {
            return;
        }
        autoImportingEmailsRef.current.add(ownerEmail);

        try {
            // Re-verify existence in current list to prevent duplicates
            const exists = licenses.some(l => 
                (l.email || '').trim().toLowerCase() === ownerEmail || 
                (l.adminEmail || '').trim().toLowerCase() === ownerEmail
            );
            if (exists) {
                autoImportingEmailsRef.current.delete(ownerEmail);
                return;
            }

            let userName = '웹 가입자';
            try {
                const userMatch = await findWebUserByEmail(ownerEmail);
                if (userMatch && userMatch.user) {
                    userName = userMatch.user.displayName || userMatch.user.userName || userName;
                }
            } catch (e) {
                console.warn("Failed to find web user details in background import:", e);
            }

            const joinCode = (tenant as any).joinCode || 'temp' + Math.floor(1000 + Math.random() * 9000);
            const businessNumber = (tenant as any).businessNumber || '';
            const password = 'temp' + Math.floor(1000 + Math.random() * 9000);

            const newLic: License = {
                adminEmail: ownerEmail,
                email: ownerEmail,
                key: ownerEmail,
                password: password,
                userName: userName,
                position: '대표자',
                role: 'ADMIN',
                companyName: tenant.name,
                plan: tenant.plan === 'pro_plus' ? 'service' : (tenant.plan === 'free' ? 'ad' : tenant.plan),
                paymentStatus: 'UNPAID',
                joinCode: joinCode,
                businessNumber: businessNumber,
                expiresAt: tenant.licenseExpiresAt || null,
                createdAt: tenant.createdAt || new Date().toISOString(),
                status: LicenseStatus.ACTIVE,
                programId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION
            } as unknown as License;

            await savePrintWorkLicense(newLic);

            try {
                const webPlan = newLic.plan === 'service' ? 'pro_plus' : (newLic.plan === 'ad' ? 'free' : newLic.plan) as any;
                await syncWebUserRole(
                    ownerEmail, 
                    webPlan, 
                    newLic.expiresAt || undefined,
                    joinCode,
                    tenant.name,
                    businessNumber,
                    ownerEmail
                );
            } catch (syncErr) {
                console.warn("[Auto-Import] Failed to sync back to Firebase:", syncErr);
            }

            // Display floating toast notification
            const notifId = Date.now().toString() + Math.random().toString();
            setAutoImportNotifications(prev => [
                ...prev,
                { id: notifId, message: `🎉 [${tenant.name}] 회원사가 자동 가입 처리되었습니다 (광고형 무료 즉시 활성화)` }
            ]);

            setTimeout(() => {
                setAutoImportNotifications(prev => prev.filter(n => n.id !== notifId));
            }, 6000);

            await loadData(true);
            await loadWebData();
        } catch (e) {
            console.error(`[Auto-Import] Background import failed for ${ownerEmail}:`, e);
        } finally {
            autoImportingEmailsRef.current.delete(ownerEmail);
        }
    };

    // Watcher useEffect for Web-Only (Route B) direct customer registrations
    useEffect(() => {
        if (isLoading || isSyncingWeb || webTenants.length === 0) return;

        const webOnlyGroups = unifiedGroups.filter(([_, data]) => data.isWebOnly && data.webTenant);

        webOnlyGroups.forEach(([_, data]) => {
            const tenant = data.webTenant;
            if (!tenant) return;

            // [Safe Isolation] Find actual owner user email to filter properly
            const ownerUser = webUsers.find(u => u.uid === tenant.ownerId || (u.tenantId === tenant.id && u.role === 'admin'));
            const ownerEmail = (ownerUser?.email || tenant.ownerId || '').trim().toLowerCase();
            
            if (!ownerEmail || !ownerEmail.includes('@')) return;

            // Skip test accounts containing 'test', 'example', '테스트', '샘플' in email or company name
            const isTestEmail = ownerEmail.includes('test') || ownerEmail.includes('example');
            const isTestCompany = (tenant.name || '').toLowerCase().includes('test') || 
                                  (tenant.name || '').includes('테스트') || 
                                  (tenant.name || '').includes('샘플') || 
                                  (tenant.name || '').toLowerCase().includes('example');
            const isTempHubEmail = ownerEmail.endsWith('@ez-hub.kr') || ownerEmail.includes('ez-hub') || ownerEmail.startsWith('user-');
            
            if (isTestEmail || isTestCompany || isTempHubEmail) {
                return;
            }

            const exists = licenses.some(l => 
                (l.email || '').trim().toLowerCase() === ownerEmail || 
                (l.adminEmail || '').trim().toLowerCase() === ownerEmail
            );

            if (!exists && !autoImportingEmailsRef.current.has(ownerEmail)) {
                autoImportTenantToSheetSilent(tenant);
            }
        });
    }, [unifiedGroups, isLoading, isSyncingWeb, licenses, webTenants, webUsers]);

    // [NEW] Automatic Daily Cloud Backup Trigger (100% Free Google Drive)
    useEffect(() => {
        const checkAndRunAutoBackup = async () => {
            const today = new Date().toISOString().split('T')[0]; // e.g. "2026-05-21"
            const lastBackupDate = localStorage.getItem('ezprintwork_last_auto_backup_date');
            
            if (lastBackupDate !== today && licenses.length > 0 && webTenants.length > 0) {
                console.log("[AutoBackup] Triggering scheduled daily database cloud backup...");
                try {
                    await runDailyAutoBackup();
                    localStorage.setItem('ezprintwork_last_auto_backup_date', today);
                    console.log("[AutoBackup] Scheduled daily database cloud backup complete.");
                    
                    // Show a silent toast notification of backup success
                    const notifId = 'backup-' + Date.now().toString();
                    setAutoImportNotifications(prev => [
                        ...prev,
                        { id: notifId, message: "🛡️ [시스템 백업] 전체 데이터베이스가 구글 드라이브 클라우드 저장소에 안전하게 백업되었습니다 (용량 100% 무료)." }
                    ]);
                    setTimeout(() => {
                        setAutoImportNotifications(prev => prev.filter(n => n.id !== notifId));
                    }, 8000);
                } catch (err) {
                    console.error("[AutoBackup] Daily scheduled backup failed:", err);
                }
            }
        };

        if (!isLoading && licenses.length > 0) {
            checkAndRunAutoBackup();
        }
    }, [licenses, webTenants, isLoading]);

    // [NEW] Backup & Recovery UI handlers
    const loadBackups = async () => {
        setIsBackupLoading(true);
        setBackupStatusMessage('구글 드라이브 백업 파일 목록을 불러오는 중...');
        try {
            const list = await fetchGoogleDriveBackups();
            setBackupList(list);
            setBackupStatusMessage('');
        } catch (err: any) {
            setBackupStatusMessage(`백업 파일 목록 조회 실패: ${err.message}`);
        } finally {
            setIsBackupLoading(false);
        }
    };

    const handleCreateManualBackup = async () => {
        setIsBackupLoading(true);
        setBackupStatusMessage('전체 데이터베이스(B2B 권한, 업무 로그) 스냅샷을 생성하는 중...');
        try {
            const backupJson = await generateFullDatabaseBackup();
            const dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const fileName = `EzPrintWork_Backup_${dateStr}.json`;

            // Trigger browser local download for immediate physical copy (completely free)
            const blob = new Blob([backupJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Also upload to cloud (Google Drive) as a double shield
            setBackupStatusMessage('구글 드라이브 클라우드 백업을 전송하는 중...');
            await runDailyAutoBackup();
            
            alert('전체 데이터베이스 백업이 완료되었습니다!\n1. 내 PC 다운로드 완료\n2. 구글 드라이브 클라우드 저장소 전송 완료 (무료 저장 공간 활용)');
            await loadBackups();
        } catch (err: any) {
            alert(`백업 파일 생성 실패: ${err.message}`);
        } finally {
            setIsBackupLoading(false);
            setBackupStatusMessage('');
        }
    };

    const handleRestoreFromDrive = async (fileId: string, fileName: string) => {
        if (!window.confirm(`[🚨 재난 데이터 복구 경고]\n정말로 '${fileName}' 백업 파일로 복구를 진행하시겠습니까?\n\n이 작업을 진행하면 현재 파이어베이스의 모든 회원사 정보, 직원 목록, 업무 로그(주문, 작업 등)가 백업 시점의 상태로 완전히 덮어씌워집니다.\n진행하시려면 확인을 눌러주세요.`)) return;

        setIsLoading(true);
        setIsBackupLoading(true);
        setBackupStatusMessage('클라우드로부터 백업 파일을 다운로드하는 중...');
        try {
            const content = await fetchBackupContentFromDrive(fileId);
            setBackupStatusMessage('데이터베이스 원상 복구를 적용하는 중 (이중 트랜잭션)...');
            await restoreFullDatabaseFromBackup(content);
            
            alert('🎉 데이터베이스 원상 복구가 완벽히 완료되었습니다!\n화면의 데이터를 새로고침합니다.');
            setShowBackupModal(false);
            await loadData(true);
            await loadWebData();
        } catch (err: any) {
            alert(`원상 복구 중 오류가 발생했습니다: ${err.message}`);
        } finally {
            setIsLoading(false);
            setIsBackupLoading(false);
            setBackupStatusMessage('');
        }
    };

    const handleDeleteBackup = async (fileId: string, fileName: string) => {
        if (!window.confirm(`정말로 백업 파일 '${fileName}'을 클라우드 저장소에서 영구 삭제하시겠습니까?`)) return;
        setIsBackupLoading(true);
        try {
            await removeBackupFromDrive(fileId);
            alert('백업 파일이 안전하게 삭제되었습니다.');
            await loadBackups();
        } catch (err: any) {
            alert(`백업 파일 삭제 실패: ${err.message}`);
        } finally {
            setIsBackupLoading(false);
        }
    };

    const handleRestoreFromLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!window.confirm(`[🚨 로컬 파일 복구 경고]\n정말로 선택한 로컬 파일 '${file.name}'으로 전체 복구를 진행하시겠습니까?\n\n현재 파이어베이스의 모든 데이터(회사 정보, 직원, 주문/작업 로그)가 덮어씌워집니다.`)) {
            e.target.value = '';
            return;
        }

        setIsLoading(true);
        setIsBackupLoading(true);
        setBackupStatusMessage('선택한 로컬 파일의 무결성을 검증하는 중...');
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = event.target?.result as string;
                setBackupStatusMessage('로컬 파일 백업본을 데이터베이스에 적용하는 중...');
                await restoreFullDatabaseFromBackup(content);
                alert('🎉 로컬 백업 파일을 통한 전체 복구가 완전히 완료되었습니다!');
                setShowBackupModal(false);
                await loadData(true);
                await loadWebData();
            } catch (err: any) {
                alert(`로컬 파일 복구 실패: ${err.message}`);
            } finally {
                setIsLoading(false);
                setIsBackupLoading(false);
                setBackupStatusMessage('');
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    const handleSaveGroup = async () => {
        if (!newLicense.companyName) {
            alert('회사명을 입력해주세요.');
            return;
        }
        if (!newLicense.joinCode || newLicense.joinCode.trim().length < 6) {
            alert('회사입장코드는 최소 6글자 이상 입력해주세요.');
            return;
        }
        if (!newLicense.email) {
            alert('로그인 ID(이메일)를 입력해주세요.');
            return;
        }

        // 중복 이메일 검증
        const emailLower = newLicense.email.trim().toLowerCase();
        const isDuplicate = licenses.some(l => 
            l.id !== newLicense.id && 
            l.email.toLowerCase() === emailLower && 
            l.email !== ''
        );
        
        if (isDuplicate) {
            const dupCompany = licenses.find(l => 
                l.id !== newLicense.id && 
                l.email.toLowerCase() === emailLower
            )?.companyName || '다른 회사';
            alert(`이미 [${dupCompany}]에서 사용 중인 로그인 ID(이메일)입니다. 다른 이메일을 사용해주세요.`);
            return;
        }

        let oldEmail: string | undefined = undefined;
        if (isEditing && newLicense.id) {
            const originalLicense = licenses.find(l => l.id === newLicense.id);
            if (originalLicense) {
                oldEmail = originalLicense.email;
            }
        }

        setIsLoading(true);
        try {
            const finalPassword = newLicense.password || 'temp' + Math.floor(1000 + Math.random() * 9000);
            await savePrintWorkLicense({
                ...newLicense,
                password: finalPassword,
                adminEmail: newLicense.email,
                key: newLicense.email,
                role: 'ADMIN',
                programId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION,
                createdAt: newLicense.createdAt || new Date().toISOString()
            } as unknown as License);
            
            try {
                const webPlan = newLicense.plan === 'service' ? 'pro_plus' : (newLicense.plan === 'ad' ? 'free' : newLicense.plan) as any;
                await syncWebUserRole(
                    newLicense.email!, 
                    webPlan, 
                    newLicense.expiresAt || undefined,
                    newLicense.joinCode,
                    newLicense.companyName,
                    newLicense.businessNumber,
                    oldEmail
                );
            } catch (e) {
                console.warn("Auto-sync failed:", e);
            }

            await loadData(true);
            setShowModal(false);
        } catch (err) { 
            alert('그룹 저장 중 오류 발생'); 
        } finally { 
            setIsLoading(false); 
        }
    };

    const handleAddMember = async () => {
        if (!targetGroup) return;
        if (!newLicense.email) {
            alert('로그인 ID(이메일)를 입력해주세요.');
            return;
        }

        // 중복 이메일 검증
        const emailLower = newLicense.email.trim().toLowerCase();
        const isDuplicate = licenses.some(l => 
            l.id !== newLicense.id && 
            l.email.toLowerCase() === emailLower && 
            l.email !== ''
        );
        
        if (isDuplicate) {
            const dupCompany = licenses.find(l => 
                l.id !== newLicense.id && 
                l.email.toLowerCase() === emailLower
            )?.companyName || '다른 회사';
            alert(`이미 [${dupCompany}]에서 사용 중인 로그인 ID(이메일)입니다. 다른 이메일을 사용해주세요.`);
            return;
        }

        setIsLoading(true);
        try {
            const groupInfo = unifiedGroups.find(([key]) => key === targetGroup)?.[1];
            const adminInfo = groupInfo?.admin;

            await savePrintWorkLicense({
                ...newLicense,
                adminEmail: adminInfo?.adminEmail || adminInfo?.email || targetGroup.split('_')[0],
                key: newLicense.email,
                role: 'MEMBER',
                companyName: adminInfo?.companyName || targetGroup.split('_')[1],
                plan: adminInfo?.plan,
                paymentStatus: adminInfo?.paymentStatus,
                expiresAt: adminInfo?.expiresAt,
                programId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION
            } as unknown as License);
            await loadData(true);
            setShowModal(false);
        } catch (err) { 
            alert('직원 정보 저장 중 오류 발생'); 
        } finally { 
            setIsLoading(false); 
        }
    };

    const toggleLicenseStatus = async (license: License) => {
        const nextStatus = license.status === LicenseStatus.ACTIVE ? LicenseStatus.EXPIRED : LicenseStatus.ACTIVE;
        setIsLoading(true);
        try {
            await savePrintWorkLicense({ ...license, status: nextStatus });
            await loadData(true);
        } catch (e) { 
            alert('상태 변경 실패'); 
        } finally { 
            setIsLoading(false); 
        }
    };

    const handleDelete = async (id: string, email: string) => {
        const emailLower = email.trim().toLowerCase();
        if (emailLower === 'ccp5770@gmail.com' || emailLower === 'ccpt78@gmail.com') {
            alert('정상 가입된 실제 춘천인쇄 대표자 라이선스는 삭제할 수 없습니다.');
            return;
        }
        if (!window.confirm(`${email} 라이선스를 삭제하시겠습니까?`)) return;
        setIsLoading(true);
        try {
            await deletePrintWorkLicense(id);
            try {
                // Find matching web user to get safe UID and tenantId
                const targetUser = webUsers.find(u => u.email?.trim().toLowerCase() === email.trim().toLowerCase());
                const targetUid = targetUser?.uid || (id.startsWith('pw-') ? id.substring(3) : null);
                const targetTenantId = targetUser?.tenantId || '';

                if (targetUid) {
                    await deleteWebUserDirect(targetUid, targetTenantId);
                    console.log(`[SafeDelete] Successfully deleted B2B User safely by ID: ${targetUid}`);
                } else {
                    // Fallback to email deletion only if no UID is found
                    await deleteWebUser(email);
                }
            } catch (fe) {
                console.error("Failed to delete web user:", fe);
            }
            await loadData(true);
            await loadWebData();
        } catch (e) { 
            alert('삭제 실패'); 
        } finally { 
            setIsLoading(false); 
        }
    };

    const handleDeleteGroup = (groupAdmin: License | null, members: License[], companyName: string, webTenant: Tenant | null) => {
        setGroupToDelete({ groupAdmin, members, companyName, webTenant });
        setShowConfirmModal(true);
    };

    const confirmDeleteGroup = async () => {
        if (!groupToDelete) return;
        
        // [Safe Isolation] 진짜 활성 춘천인쇄 테넌트 오폭 삭제 방지
        const adminEmail = (groupToDelete.groupAdmin?.email || groupToDelete.groupAdmin?.adminEmail || '').trim().toLowerCase();
        if (adminEmail === 'ccp5770@gmail.com' || adminEmail === 'ccpt78@gmail.com') {
            alert('정상 가입된 실제 춘천인쇄 대표자 라이선스 그룹은 삭제할 수 없습니다.');
            setShowConfirmModal(false);
            setGroupToDelete(null);
            return;
        }

        const allIds: string[] = [];
        if (groupToDelete.groupAdmin) allIds.push(groupToDelete.groupAdmin.id);
        groupToDelete.members.forEach(m => allIds.push(m.id));

        if (allIds.length === 0) {
            setShowConfirmModal(false);
            return;
        }

        setIsLoading(true);
        setShowConfirmModal(false);
        try {
            // 1. Google Sheets licenses bulk deletion
            await deletePrintWorkLicensesBulk(allIds);
            
            // 2. Safe Tenant and Users direct deletion from Firestore (100% ID-based, NO email collisions!)
            let targetTenantId = groupToDelete.webTenant?.id;
            if (!targetTenantId && groupToDelete.groupAdmin?.id?.startsWith('web-')) {
                targetTenantId = groupToDelete.groupAdmin.id.substring(4); // "web-tenantID" -> "tenantID"
            }

            if (targetTenantId) {
                try {
                    await deleteWebTenantDirect(targetTenantId);
                    console.log(`[SafeDelete] Successfully deleted B2B Tenant directly: ${targetTenantId}`);
                } catch (fe) {
                    console.error("[SafeDelete] Failed to delete web tenant directly:", fe);
                }
            } else if (groupToDelete.groupAdmin?.email) {
                // Fallback (Only when no ID is found, though ID is always preferred)
                try {
                    await deleteWebTenantAndUsers(groupToDelete.groupAdmin.email);
                } catch (fe) {
                    console.error("[SafeDelete] Fallback email delete failed:", fe);
                }
            }

            await loadData(true);
            await loadWebData();
            setGroupToDelete(null);
        } catch (e) {
            alert('그룹 삭제 실패');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-180px)] bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
            {/* Auto-Import Toast Notifications */}
            {autoImportNotifications.length > 0 && (
                <div className="fixed top-6 right-6 z-[10000] flex flex-col gap-3 max-w-md w-full pointer-events-none">
                    {autoImportNotifications.map(notif => (
                        <div 
                            key={notif.id}
                            className="pointer-events-auto bg-green-600 text-white px-5 py-4 rounded-2xl shadow-xl flex items-center justify-between gap-4 border border-green-500/20 backdrop-blur-md animate-fade-in"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-white shrink-0">
                                    <i className="fas fa-check-circle text-base"></i>
                                </div>
                                <div className="text-xs font-black leading-snug">{notif.message}</div>
                            </div>
                            <button 
                                onClick={() => setAutoImportNotifications(prev => prev.filter(n => n.id !== notif.id))}
                                className="text-white/70 hover:text-white transition-colors"
                            >
                                <i className="fas fa-times text-xs"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Toolbar */}
            <div className="bg-white p-4 border-b flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-6">
                    <h2 className="text-xl font-black text-gray-800 tracking-tight flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center shadow-lg shadow-green-100">
                            <i className="fas fa-users text-white text-sm"></i>
                        </div>
                        EzPrintWork 팀 관리
                    </h2>
                    <div className="relative w-72">
                        <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input 
                            type="text" 
                            className="w-full pl-9 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-600 transition-all font-medium placeholder-gray-400 text-gray-800"
                            placeholder="회사명, 관리자 검색..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button 
                                onClick={() => setSearchTerm('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs animate-fade-in"
                            >
                                <i className="fas fa-times-circle"></i>
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-gray-100/80 px-3 py-1.5 rounded-xl mr-4 border border-gray-200/50">
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">가입 현황</span>
                        <div className="h-3 w-[1px] bg-gray-300 mx-1"></div>
                        <span className="text-[11px] font-bold text-gray-700">시트 등록 <strong className="text-green-600 font-extrabold">{unifiedGroups.filter(([_, d]) => !d.isWebOnly).length}</strong>건</span>
                        <div className="h-2 w-2 bg-gray-300 rounded-full mx-1"></div>
                        <span className="text-[11px] font-bold text-gray-700">가입 대기 <strong className="text-amber-500 font-extrabold">{unifiedGroups.filter(([_, d]) => d.isWebOnly).length}</strong>건</span>
                    </div>
                    <button onClick={() => { setShowBackupModal(true); loadBackups(); }} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-2 active:scale-95">
                        <i className="fas fa-shield-alt"></i> 백업 및 복구 센터
                    </button>
                    <button onClick={() => syncPrintWorkStructure().then(() => loadData(true))} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-amber-100 hover:bg-amber-600 transition-all flex items-center gap-2 active:scale-95">
                        <i className="fas fa-sync-alt"></i> 시트 구조 동기화
                    </button>
                    <button onClick={() => {
                        setModalType('group');
                        setIsEditing(false);
                        setNewLicense({ 
                            plan: 'ad', 
                            status: LicenseStatus.ACTIVE, 
                            paymentStatus: 'UNPAID', 
                            role: 'ADMIN',
                            password: 'temp' + Math.floor(1000 + Math.random() * 9000)
                        });
                        setShowModal(true);
                    }} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-green-100 hover:bg-green-700 transition-all flex items-center gap-2">
                        <i className="fas fa-plus-circle"></i> 신규 그룹 등록
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* Firebase Ghost Cleanup Banner */}
                {ghostTenants.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3 text-red-700">
                            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
                                <i className="fas fa-ghost text-lg"></i>
                            </div>
                            <div>
                                <h4 className="text-xs font-black">구글 시트에서 삭제되었으나 파이어베이스(웹) 서버에 잔재하는 유령 테넌트 {ghostTenants.length}개가 감지되었습니다.</h4>
                                <p className="text-[10px] text-red-500 font-bold">이들이 남긴 유령 데이터로 인해 웹(ezprintwork) 로그인이 허용되고 있습니다.</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {ghostTenants.map(gt => (
                                <button
                                    key={gt.id}
                                    onClick={async () => {
                                        if (window.confirm(`[${gt.name}] 웹 서버 데이터를 영구 삭제하고 접속을 완전 차단하시겠습니까?\n이메일: ${gt.ownerId || '알수없음'}\n이 작업은 되돌릴 수 없습니다.`)) {
                                            setIsLoading(true);
                                            try {
                                                await deleteWebTenantDirect(gt.id);
                                                await loadWebData();
                                                alert(`[${gt.name}] 웹 서버 데이터 및 로그인 계정이 완전히 영구 차단 및 삭제되었습니다.`);
                                            } catch (err) {
                                                alert('웹 서버 데이터 정리 실패');
                                            } finally {
                                                setIsLoading(false);
                                            }
                                        }
                                    }}
                                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-black shadow-lg shadow-red-200 transition-all flex items-center gap-1.5 active:scale-95"
                                >
                                    <i className="fas fa-trash-alt"></i>
                                    [{gt.name}] 웹 삭제 및 차단
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <table className="w-full text-xs text-gray-500 border-collapse table-fixed">
                        <colgroup>
                            <col className="w-[45px]" />
                            <col className="w-[115px]" />
                            <col className="w-[140px]" />
                            <col className="w-[85px]" />
                            <col className="w-[145px]" />
                            <col className="w-[105px]" />
                            <col className="w-[95px]" />
                            <col className="w-[115px]" />
                            <col className="w-[105px]" />
                            <col className="w-[80px]" />
                            <col className="w-[95px]" />
                            <col className="w-[90px]" />
                            <col className="w-[125px]" />
                        </colgroup>
                        <thead>
                            <tr className="bg-gray-100/80 border-b border-gray-200 text-gray-700 font-bold">
                                <th className="py-3 px-3 text-center">No</th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('createdAt')}>
                                    최초등록일 {renderSortIcon('createdAt')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('companyName')}>
                                    회사명 {renderSortIcon('companyName')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('userName')}>
                                    대표자 {renderSortIcon('userName')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('adminEmail')}>
                                    관리자 이메일 {renderSortIcon('adminEmail')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('businessNumber')}>
                                    사업자번호 {renderSortIcon('businessNumber')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('joinCode')}>
                                    입장코드 {renderSortIcon('joinCode')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('contactInfo')}>
                                    연락처 {renderSortIcon('contactInfo')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('plan')}>
                                    요금제 {renderSortIcon('plan')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('paymentStatus')}>
                                    결제 {renderSortIcon('paymentStatus')}
                                </th>
                                <th className="py-3 px-3 text-left cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('expiresAt')}>
                                    만료일 {renderSortIcon('expiresAt')}
                                </th>
                                <th className="py-3 px-3 text-center cursor-pointer hover:bg-gray-200/50" onClick={() => handleSort('webTenant')}>
                                    연동상태 {renderSortIcon('webTenant')}
                                </th>
                                <th className="py-3 px-3 text-center">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {sortedGroups.map(([groupKey, data], index) => {
                                const planKey = (data.admin?.plan || 'ad') as keyof typeof PLAN_DEFS;
                                const planInfo = PLAN_DEFS[planKey] || PLAN_DEFS.ad;
                                const activeCount = (data.admin?.status === LicenseStatus.ACTIVE ? 1 : 0) + 
                                                   data.members.filter(m => m.status === LicenseStatus.ACTIVE).length;
                                const isExpanded = expandedGroups.has(groupKey);
                                const adminEmail = data.admin?.adminEmail || data.admin?.email || '';
                                const isExpired = data.admin?.expiresAt && new Date(data.admin.expiresAt) < new Date();
                                const isWebOnly = data.isWebOnly;

                                return (
                                    <React.Fragment key={groupKey}>
                                        <tr 
                                            className={`hover:bg-gray-50/80 transition-colors cursor-pointer ${
                                                isExpanded ? (isWebOnly ? 'bg-amber-50/10' : 'bg-green-50/20') : ''
                                            } ${isWebOnly ? 'bg-amber-50/5' : ''}`}
                                            onClick={() => toggleGroup(groupKey)}
                                        >
                                            <td className="py-3.5 px-3 text-center text-gray-400 font-bold font-mono">{index + 1}</td>
                                            <td className="py-3.5 px-3 font-mono text-gray-500 truncate" title={data.admin?.createdAt ? new Date(data.admin.createdAt).toLocaleString() : ''}>
                                                {data.admin?.createdAt ? new Date(data.admin.createdAt).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="py-3.5 px-3 font-semibold text-gray-900 truncate">
                                                <div className="flex items-center gap-1.5">
                                                    <i className={`fas ${isExpanded ? 'fa-folder-open text-indigo-500' : 'fa-folder text-gray-400'}`}></i>
                                                    <span className="truncate" title={data.companyName}>{data.companyName}</span>
                                                </div>
                                            </td>
                                            <td className="py-3.5 px-3 font-bold text-gray-800 truncate">
                                                {isWebOnly ? '웹 가입자' : data.admin?.userName || '-'}
                                            </td>
                                            <td className="py-3.5 px-3 font-mono font-medium text-gray-600 truncate" title={adminEmail}>
                                                {adminEmail || '-'}
                                            </td>
                                            <td className="py-3.5 px-3 font-mono text-gray-500 truncate">
                                                {data.admin?.businessNumber || '-'}
                                            </td>
                                            <td className="py-3.5 px-3 text-left">
                                                {data.admin?.joinCode ? (
                                                    <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-black font-mono text-[10px]">{data.admin.joinCode}</span>
                                                ) : '-'}
                                            </td>
                                            <td className="py-3.5 px-3 text-left truncate font-mono text-gray-500" title={data.admin?.contactInfo || ''}>
                                                {data.admin?.contactInfo ? formatContactInput(data.admin.contactInfo) : '-'}
                                            </td>
                                            <td className="py-3.5 px-3">
                                                <div className="flex items-center gap-1">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${planInfo.color}`}>
                                                        {planInfo.label}
                                                    </span>
                                                    {!isWebOnly && (
                                                        <span className={`text-[10px] font-bold ${activeCount > planInfo.max ? 'text-red-500' : 'text-gray-400'}`} title={`활성: ${activeCount} / 최대: ${planInfo.max}`}>
                                                            ({activeCount}/{planInfo.max})
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3.5 px-3">
                                                {!isWebOnly && data.admin ? (
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                                        data.admin.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 
                                                        data.admin.paymentStatus === 'FREE' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'
                                                    }`}>
                                                        {data.admin.paymentStatus === 'PAID' ? '결제완료' : data.admin.paymentStatus === 'FREE' ? '무료사용' : '미결제'}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="py-3.5 px-3">
                                                {!isWebOnly && data.admin ? (
                                                    <div className={`font-mono font-bold text-[11px] ${isExpired ? 'text-red-500' : 'text-gray-600'}`}>
                                                        {data.admin.expiresAt ? new Date(data.admin.expiresAt).toLocaleDateString() : '무제한'}
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td className="py-3.5 px-3 text-center">
                                                {isWebOnly ? (
                                                    <span className="bg-amber-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-black flex items-center justify-center gap-0.5 shadow-sm shadow-amber-100">
                                                        <i className="fas fa-clock text-[8px] animate-pulse"></i> 대기
                                                    </span>
                                                ) : data.webTenant ? (
                                                    <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-bold flex items-center justify-center gap-0.5 shadow-sm shadow-blue-100" title="웹 연동 완료">
                                                        <i className="fab fa-google text-[8px]"></i> 연동
                                                    </span>
                                                ) : (
                                                    <span className="bg-gray-200 text-gray-500 text-[9px] px-1.5 py-0.5 rounded-md font-medium flex items-center justify-center">OFF</span>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-center gap-1.5">
                                                    {!isWebOnly ? (
                                                        <>
                                                            <button 
                                                                onClick={() => handleSyncToWeb(adminEmail, data.admin?.plan || 'ad', data.admin?.expiresAt || null)}
                                                                disabled={isSyncingWeb}
                                                                className="p-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-blue-50 hover:text-blue-600 border border-gray-200/50 hover:border-blue-100 transition-colors"
                                                                title="Sync Web (웹 동기화)"
                                                            >
                                                                <i className={`fas ${isSyncingWeb ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'} text-[11px]`}></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => {
                                                                    setTargetGroup(adminEmail + "_" + data.companyName);
                                                                    setModalType('member');
                                                                    setNewLicense({ role: 'MEMBER', status: LicenseStatus.ACTIVE });
                                                                    setShowModal(true);
                                                                }} 
                                                                className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 border border-green-200/30 transition-colors" 
                                                                title="직원 추가"
                                                            >
                                                                <i className="fas fa-user-plus text-[11px]"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => {
                                                                    if (data.admin) {
                                                                        setNewLicense(data.admin);
                                                                        setModalType('group');
                                                                        setIsEditing(true);
                                                                        setShowModal(true);
                                                                    } else {
                                                                        alert('관리자 정보가 없어 수정할 수 없습니다.');
                                                                    }
                                                                }} 
                                                                className="p-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-200 border border-gray-200/50 transition-colors" 
                                                                title="그룹 수정"
                                                            >
                                                                <i className="fas fa-cog text-[11px]"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteGroup(data.admin, data.members, data.companyName, data.webTenant)} 
                                                                className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 border border-red-200/30 transition-colors" 
                                                                title="그룹 삭제"
                                                            >
                                                                <i className="fas fa-trash-alt text-[11px]"></i>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleImportTenantToSheet(data.webTenant!)}
                                                            className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-[10px] font-black hover:bg-green-700 transition-all flex items-center gap-1 shadow-sm active:scale-95"
                                                        >
                                                            <i className="fas fa-download text-[9px]"></i> 시트 등록
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {isExpanded && (
                                            <tr className="bg-gray-50/50">
                                                <td colSpan={13} className="p-4 border-t border-gray-200/60">
                                                    {isWebOnly ? (
                                                        <div className="py-6 text-center space-y-3">
                                                            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-xl shadow-sm">
                                                                <i className="fas fa-user-clock"></i>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <h4 className="font-black text-gray-800 text-xs">가입 대기 중인 신규 회원사입니다</h4>
                                                                <p className="text-[10px] text-gray-400 max-w-sm mx-auto">
                                                                    구글 시트에 대표자 계정을 정식 라이선스로 등록하면 자동으로 암호가 발급되며 모든 데스크톱 및 웹 로그인이 가능해집니다.
                                                                </p>
                                                            </div>
                                                            <button 
                                                                onClick={() => handleImportTenantToSheet(data.webTenant!)}
                                                                className="px-4 py-2 bg-green-600 text-white font-black rounded-xl text-[10px] hover:bg-green-700 transition-all inline-flex items-center gap-1.5 shadow-md shadow-green-100"
                                                            >
                                                                <i className="fas fa-file-invoice text-xs"></i> 이 회사 라이선스를 구글 시트에 정식 등록
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
                                                            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200/60 flex items-center justify-between">
                                                                <span className="text-[10px] font-black text-slate-500 flex items-center gap-1.5">
                                                                    <i className="fas fa-users-cog text-slate-400"></i> 사내 직원 상세 속성 ({data.members.length}명)
                                                                </span>
                                                            </div>
                                                            <table className="w-full text-[11px] table-fixed">
                                                                <colgroup>
                                                                    <col className="w-[70px]" />
                                                                    <col className="w-[100px]" />
                                                                    <col className="w-[170px]" />
                                                                    <col className="w-[120px]" />
                                                                    <col className="w-[100px]" />
                                                                    <col className="w-[100px]" />
                                                                    <col className="w-[150px]" />
                                                                    <col className="w-[90px]" />
                                                                </colgroup>
                                                                <thead>
                                                                    <tr className="text-gray-400 border-b border-gray-100 bg-gray-50/30 text-left font-bold">
                                                                        <th className="py-2.5 px-4">상태</th>
                                                                        <th className="py-2.5 px-3">이름</th>
                                                                        <th className="py-2.5 px-3">로그인 ID (이메일)</th>
                                                                        <th className="py-2.5 px-3">연락처</th>
                                                                        <th className="py-2.5 px-3">직급 / 직책</th>
                                                                        <th className="py-2.5 px-3">비밀번호</th>
                                                                        <th className="py-2.5 px-3 text-center">최근 접속</th>
                                                                        <th className="py-2.5 px-4 text-right">관리</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-gray-100">
                                                                    {data.members.map(m => {
                                                                        const displayId = m.email && m.email.endsWith('@ez-hub.kr') ? m.email.split('@')[0] : m.email;
                                                                        const formatAccessTime = (timeStr?: string | null) => {
                                                                            if (!timeStr) return '미접속';
                                                                            const d = new Date(timeStr);
                                                                            if (isNaN(d.getTime())) return timeStr;
                                                                            return d.toLocaleString('ko-KR', {
                                                                                year: 'numeric',
                                                                                month: '2-digit',
                                                                                day: '2-digit',
                                                                                hour: '2-digit',
                                                                                minute: '2-digit',
                                                                                hour12: false
                                                                            });
                                                                        };
                                                                        return (
                                                                            <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                                                                                <td className="py-2.5 px-4">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <button 
                                                                                            onClick={() => toggleLicenseStatus(m)}
                                                                                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-black transition-all ${m.status === LicenseStatus.ACTIVE ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-300 text-white'}`}
                                                                                        >
                                                                                            {m.status === LicenseStatus.ACTIVE ? 'ACTIVE' : 'OFF'}
                                                                                        </button>
                                                                                        {m.isOnline ? (
                                                                                            <span className="inline-flex items-center gap-1 text-[9px] font-black text-green-600 shrink-0" title="온라인">
                                                                                                <span className="relative flex h-1.5 w-1.5">
                                                                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                                                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                                                                                                </span>
                                                                                                온라인
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-gray-400 shrink-0" title="오프라인">
                                                                                                <span className="h-1.5 w-1.5 rounded-full bg-gray-300"></span>
                                                                                                오프라인
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="py-2.5 px-3 font-bold text-gray-800">{m.userName}</td>
                                                                                <td className="py-2.5 px-3 text-gray-500 font-mono font-medium truncate" title={m.email}>{displayId}</td>
                                                                                <td className="py-2.5 px-3 text-gray-500 font-mono" title={m.contactInfo || ''}>
                                                                                    {m.contactInfo ? formatContactInput(m.contactInfo) : '-'}
                                                                                </td>
                                                                                <td className="py-2.5 px-3 text-slate-500 font-medium">{m.position || '직원'}</td>
                                                                                <td className="py-2.5 px-3 text-gray-600 font-mono font-bold">
                                                                                    {m.role === 'ADMIN' ? (
                                                                                        <span className="text-blue-600 font-black text-[9px] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 inline-flex items-center gap-1">
                                                                                            <i className="fab fa-google text-[8px]"></i> 구글 전용
                                                                                        </span>
                                                                                    ) : (
                                                                                        m.password || '-'
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-2.5 px-3 text-center text-gray-500 font-mono font-medium">
                                                                                    {formatAccessTime(m.lastCheckIn)}
                                                                                </td>
                                                                                <td className="py-2.5 px-4 text-right">
                                                                                    <div className="flex justify-end gap-1.5">
                                                                                        <button 
                                                                                            onClick={() => {
                                                                                                setTargetGroup(adminEmail + "_" + data.companyName);
                                                                                                setNewLicense(m);
                                                                                                setModalType('member');
                                                                                                setIsEditing(true);
                                                                                                setShowModal(true);
                                                                                            }} 
                                                                                            className="p-1 bg-gray-50 hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 rounded border border-gray-200/50 transition-colors"
                                                                                            title="직원 수정"
                                                                                        >
                                                                                            <i className="fas fa-cog text-[10px]"></i>
                                                                                        </button>
                                                                                        <button 
                                                                                            onClick={() => handleDelete(m.id, m.email)} 
                                                                                            className="p-1 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded border border-gray-200/50 transition-colors"
                                                                                            title="직원 삭제"
                                                                                        >
                                                                                            <i className="fas fa-user-minus text-[10px]"></i>
                                                                                        </button>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                    {data.members.length === 0 && (
                                                                        <tr>
                                                                            <td colSpan={8} className="py-6 text-center text-gray-400 italic font-medium">
                                                                                등록된 사내 직원이 없습니다.
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {sortedGroups.length === 0 && (
                    <div className="py-20 text-center text-gray-400 italic font-medium">
                        가입 또는 등록된 회사 목록이 없습니다.
                    </div>
                )}
            </div>

            {/* Group/Member Modal */}
            {showModal && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" 
                    onMouseDown={(e) => { mouseDownTargetRef.current = e.target; }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
                            setShowModal(false);
                        }
                    }}
                >
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/20" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                        <div className="px-8 py-6 border-b flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h3 className="text-xl font-black text-gray-800">
                                    {modalType === 'group' ? (isEditing ? '그룹 정보 수정' : '신규 그룹 등록') : (isEditing ? '직원 정보 수정' : '직원 추가 등록')}
                                </h3>
                                <p className="text-xs text-gray-400 font-bold mt-1">
                                    {modalType === 'group' ? '회사의 대표 계정과 요금제를 설정합니다.' : (isEditing ? `${targetGroup} 그룹의 직원 정보를 수정합니다.` : `${targetGroup} 그룹에 직원을 추가합니다.`)}
                                </p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors text-gray-400"><i className="fas fa-times text-lg"></i></button>
                        </div>
                        
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                    {modalType === 'group' ? '관리자 이메일 (구글 계정 이메일)' : '사내 로그인 ID (Login ID)'}
                                </label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-3 border-2 border-indigo-100 focus:border-indigo-500 rounded-2xl text-sm font-black text-indigo-600 transition-all outline-none"
                                    placeholder={modalType === 'group' ? "example@gmail.com" : "사내 로그인 아이디 입력"}
                                    value={
                                        modalType === 'member' && newLicense.email && newLicense.email.endsWith('@ez-hub.kr')
                                            ? newLicense.email.split('@')[0]
                                            : newLicense.email || ''
                                    }
                                    onChange={e => {
                                        let val = e.target.value.trim();
                                        setNewLicense({...newLicense, email: val});
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                    {modalType === 'group' ? '로그인 방식 (구글 로그인 전용)' : 'Password (로그인 비밀번호)'}
                                </label>
                                {modalType === 'group' ? (
                                    <div className="w-full px-4 py-3.5 bg-blue-50 border-2 border-blue-100 rounded-2xl text-sm font-black text-blue-700 flex items-center gap-2.5 shadow-sm">
                                        <i className="fab fa-google text-blue-600 text-base animate-pulse"></i>
                                        <span>구글 로그인 전용 계정 (비밀번호 설정 불필요)</span>
                                    </div>
                                ) : (
                                    <input 
                                        type="text" 
                                        className="w-full px-4 py-3 border-2 border-indigo-50/50 bg-indigo-50/10 rounded-2xl text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                        placeholder="초기 로그인 비밀번호 입력"
                                        value={newLicense.password || ''}
                                        onChange={e => setNewLicense({...newLicense, password: e.target.value})}
                                    />
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">User Name</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold focus:border-green-500 outline-none transition-all"
                                        placeholder="홍길동"
                                        value={newLicense.userName || ''}
                                        onChange={e => setNewLicense({...newLicense, userName: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Position (직책)</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                        placeholder={modalType === 'group' ? "대표자" : "과장 / 팀장"}
                                        value={newLicense.position || ''}
                                        onChange={e => setNewLicense({...newLicense, position: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Contact Info (연락처)</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                    placeholder="010-1234-5678"
                                    value={newLicense.contactInfo || ''}
                                    onChange={e => setNewLicense({...newLicense, contactInfo: formatContactInput(e.target.value)})}
                                />
                            </div>

                             <div className="space-y-2">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Company Name</label>
                                <input 
                                    type="text" 
                                    className={`w-full px-4 py-3 border-2 rounded-2xl text-sm font-bold outline-none transition-all ${modalType === 'member' ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-gray-100 focus:border-green-500'}`}
                                    placeholder="현대인쇄"
                                    value={newLicense.companyName || ''}
                                    onChange={e => setNewLicense({...newLicense, companyName: e.target.value})}
                                    readOnly={modalType === 'member'}
                                />
                            </div>

                            {modalType === 'group' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">사업자등록번호</label>
                                        <input 
                                            type="text" 
                                            className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold focus:border-green-500 outline-none transition-all"
                                            placeholder="123-45-67890"
                                            value={newLicense.businessNumber || ''}
                                            onChange={e => setNewLicense({...newLicense, businessNumber: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">회사입장코드 (6자 이상)</label>
                                        <input 
                                            type="text" 
                                            className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                            placeholder="최소 6자 직접 입력"
                                            value={newLicense.joinCode || ''}
                                            onChange={e => setNewLicense({...newLicense, joinCode: e.target.value})}
                                        />
                                    </div>
                                </div>
                            )}

                            {modalType === 'group' && (
                                <>
                                    <div className="grid grid-cols-2 gap-4 border-t pt-6">
                                        <div className="space-y-2">
                                            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Grade (Team Plan)</label>
                                            <select 
                                                className="w-full px-4 py-3 border-2 border-blue-100 bg-blue-50/50 rounded-2xl text-sm font-black text-blue-700 outline-none focus:border-blue-500 transition-all appearance-none cursor-pointer"
                                                value={newLicense.plan}
                                                onChange={e => setNewLicense({...newLicense, plan: e.target.value})}
                                            >
                                                {Object.entries(PLAN_DEFS).map(([key, info]) => (
                                                    <option key={key} value={key}>{info.label} (최대 {info.max}명)</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Payment Status</label>
                                            <select 
                                                className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold outline-none focus:border-green-500 transition-all"
                                                value={newLicense.paymentStatus}
                                                onChange={e => setNewLicense({...newLicense, paymentStatus: e.target.value as any})}
                                            >
                                                <option value="UNPAID">🔴 미결제 (광고모드)</option>
                                                <option value="PAID">🟢 결제완료 (정상)</option>
                                                <option value="FREE">🔵 무료사용 (정상)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Expiry Date</label>
                                        <input 
                                            type="date" 
                                            className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-bold outline-none focus:border-green-500 transition-all"
                                            value={newLicense.expiresAt ? new Date(newLicense.expiresAt).toISOString().split('T')[0] : ''}
                                            onChange={e => setNewLicense({...newLicense, expiresAt: e.target.value})}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="px-8 py-6 bg-gray-50 border-t flex gap-3">
                            <button onClick={() => setShowModal(false)} className="flex-1 py-3.5 bg-white border-2 border-gray-200 text-gray-600 rounded-2xl font-black text-sm hover:bg-gray-50 transition-all active:scale-95">취소하기</button>
                            <button 
                                onClick={modalType === 'group' ? handleSaveGroup : handleAddMember}
                                disabled={isLoading}
                                className="flex-[2] py-3.5 bg-green-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-green-200 hover:bg-green-700 transition-all active:scale-95 disabled:bg-gray-400"
                            >
                                {isLoading ? '처리 중...' : (isEditing ? '정보 업데이트' : (modalType === 'group' ? '그룹 생성하기' : '직원 등록하기'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Custom Confirm Modal */}
            {showConfirmModal && groupToDelete && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col transform transition-all duration-300 scale-100">
                        {/* Header */}
                        <div className="px-6 py-5 bg-red-50 border-b border-red-100 flex items-center justify-between">
                            <div className="flex items-center gap-3 text-red-600">
                                <div className="p-2 bg-red-100/50 rounded-xl">
                                    <i className="fas fa-exclamation-triangle text-lg"></i>
                                </div>
                                <div>
                                    <h3 className="text-base font-black tracking-tight">그룹 라이선스 완전 삭제</h3>
                                    <p className="text-[10px] text-red-500 font-bold">이 작업은 취소할 수 없습니다.</p>
                                </div>
                            </div>
                            <button onClick={() => setShowConfirmModal(false)} className="text-red-400 hover:text-red-600 transition-colors">
                                <i className="fas fa-times text-lg"></i>
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-4">
                            <p className="text-sm font-bold text-gray-700 leading-relaxed">
                                <span className="text-red-600 font-black">[{groupToDelete.companyName}]</span> 그룹의 모든 라이선스를 구글 시트에서 완전히 삭제하시겠습니까?
                            </p>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                                <div className="flex justify-between text-xs font-bold text-gray-500">
                                    <span>삭제될 라이선스 총수:</span>
                                    <span className="text-red-600 font-black text-sm">
                                        {(groupToDelete.groupAdmin ? 1 : 0) + groupToDelete.members.length}개
                                    </span>
                                </div>
                                <div className="border-t border-gray-200/60 my-2 pt-2 space-y-1.5 max-h-40 overflow-y-auto">
                                    {groupToDelete.groupAdmin && (
                                        <div className="flex items-center justify-between text-[11px] text-gray-600 font-medium">
                                            <span className="truncate">👑 {groupToDelete.groupAdmin.userName || '관리자'} ({groupToDelete.groupAdmin.email})</span>
                                            <span className="bg-red-100 text-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded">ADMIN</span>
                                        </div>
                                    )}
                                    {groupToDelete.members.map((m, idx) => (
                                        <div key={m.id || idx} className="flex items-center justify-between text-[11px] text-gray-500">
                                            <span className="truncate">👤 {m.userName || '직원'} ({m.email})</span>
                                            <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-1.5 py-0.5 rounded">MEMBER</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t flex gap-3">
                            <button 
                                onClick={() => setShowConfirmModal(false)} 
                                className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 rounded-2xl font-black text-xs hover:bg-gray-50 transition-all active:scale-95"
                            >
                                취소
                            </button>
                            <button 
                                onClick={confirmDeleteGroup}
                                disabled={isLoading}
                                className="flex-[2] py-3 bg-red-600 text-white rounded-2xl font-black text-xs shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95 disabled:bg-gray-400"
                            >
                                {isLoading ? '삭제 중...' : '구글 시트에서 영구 삭제'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EzPrintWorkLicenseManager;
