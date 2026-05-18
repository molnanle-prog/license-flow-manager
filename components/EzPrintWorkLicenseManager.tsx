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
  syncPrintWorkStructure 
} from '../services/ezPrintWorkService';
import { formatContactInput } from '../utils/helpers';
import { getAllTenants, syncWebUserRole, findWebUserByEmail } from '../services/firebaseBridge';
import { Tenant } from '../types';

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
    const [viewMode, setViewMode] = useState<'sheet' | 'web'>('sheet');
    
    // [NEW] Firebase Data
    const [webTenants, setWebTenants] = useState<Tenant[]>([]);
    const [isSyncingWeb, setIsSyncingWeb] = useState(false);
    
    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [modalType, setModalType] = useState<'group' | 'member'>('group');
    const [isEditing, setIsEditing] = useState(false);
    const [targetGroup, setTargetGroup] = useState<string | null>(null);
    const [newLicense, setNewLicense] = useState<Partial<License>>({
        status: LicenseStatus.ACTIVE,
        plan: 'ad',
        role: 'ADMIN',
        programId: PROGRAM_IDS.EZPRINTWORK
    });

    const loadWebData = async () => {
        try {
            const tenants = await getAllTenants();
            setWebTenants(tenants);
        } catch (e) {
            console.error("Failed to load web tenants:", e);
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
        loadData(); 
        loadWebData();
    }, []);

    const groupedData = useMemo(() => {
        const groups: Record<string, { admin: License | null, members: License[], companyName: string }> = {};
        
        licenses.forEach(l => {
            const adminEmail = l.adminEmail || l.email;
            const companyName = l.companyName || '미지정 회사';
            const groupKey = `${adminEmail}_${companyName}`;

            if (!groups[groupKey]) {
                groups[groupKey] = { admin: null, members: [], companyName: companyName };
            }
            
            if (l.role === 'ADMIN' || (l.email === adminEmail && !groups[groupKey].admin)) {
                groups[groupKey].admin = l;
                groups[groupKey].companyName = companyName;
            } else {
                groups[groupKey].members.push(l);
            }
        });

        return Object.entries(groups)
            .filter(([_, data]) => {
                if (!searchTerm) return true;
                const searchStr = `${data.companyName} ${data.admin?.email || ''} ${data.admin?.userName || ''}`.toLowerCase();
                return searchStr.includes(searchTerm.toLowerCase());
            })
            .sort((a, b) => a[1].companyName.localeCompare(b[1].companyName));
    }, [licenses, searchTerm]);

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
            const webPlan = plan === 'service' ? 'pro_plus' : (plan === 'ad' ? 'free' : plan) as any;
            await syncWebUserRole(adminEmail, webPlan, expiresAt || undefined);
            alert('웹 동기화 성공!');
            await loadWebData();
        } catch (e) {
            alert('웹 동기화 실패: 사용자가 아직 웹에서 가입하지 않았거나 오류가 발생했습니다.');
        } finally {
            setIsSyncingWeb(false);
        }
    };

    const handleSaveGroup = async () => {
        setIsLoading(true);
        try {
            await savePrintWorkLicense({
                ...newLicense,
                adminEmail: newLicense.email,
                key: newLicense.email,
                role: 'ADMIN',
                programId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION
            } as License);
            
            try {
                const webPlan = newLicense.plan === 'service' ? 'pro_plus' : (newLicense.plan === 'ad' ? 'free' : newLicense.plan) as any;
                await syncWebUserRole(newLicense.email!, webPlan, newLicense.expiresAt || undefined);
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
        setIsLoading(true);
        try {
            const groupInfo = groupedData.find(([key]) => key === targetGroup)?.[1];
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
            } as License);
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
        if (!window.confirm(`${email} 라이선스를 삭제하시겠습니까?`)) return;
        setIsLoading(true);
        try {
            await deletePrintWorkLicense(id);
            await loadData(true);
        } catch (e) { 
            alert('삭제 실패'); 
        } finally { 
            setIsLoading(false); 
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-180px)] bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
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
                        <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                        <input 
                            type="text" 
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none transition-all"
                            placeholder={viewMode === 'sheet' ? "회사명, 관리자 검색..." : "웹 가입자 검색..."}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-gray-100 p-1 rounded-xl flex mr-4">
                        <button 
                            onClick={() => setViewMode('sheet')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'sheet' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            시트 데이터
                        </button>
                        <button 
                            onClick={() => setViewMode('web')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'web' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            웹 전용 (Firebase)
                        </button>
                    </div>
                    <button onClick={() => syncPrintWorkStructure().then(() => loadData(true))} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-amber-100 hover:bg-amber-600 transition-all flex items-center gap-2">
                        <i className="fas fa-sync-alt"></i> 시트 구조 동기화
                    </button>
                    <button onClick={() => {
                        setModalType('group');
                        setIsEditing(false);
                        setNewLicense({ plan: 'ad', status: LicenseStatus.ACTIVE, paymentStatus: 'UNPAID', role: 'ADMIN' });
                        setShowModal(true);
                    }} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-green-100 hover:bg-green-700 transition-all flex items-center gap-2">
                        <i className="fas fa-plus-circle"></i> 신규 그룹 등록
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {viewMode === 'sheet' ? (
                    groupedData.map(([groupKey, data]) => {
                        const planKey = (data.admin?.plan || 'ad') as keyof typeof PLAN_DEFS;
                        const planInfo = PLAN_DEFS[planKey] || PLAN_DEFS.ad;
                        const activeCount = (data.admin?.status === LicenseStatus.ACTIVE ? 1 : 0) + 
                                           data.members.filter(m => m.status === LicenseStatus.ACTIVE).length;
                        const isExpanded = expandedGroups.has(groupKey);
                        const adminEmail = data.admin?.adminEmail || data.admin?.email || '';
                        const isExpired = data.admin?.expiresAt && new Date(data.admin.expiresAt) < new Date();

                        return (
                            <div key={groupKey} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
                                <div className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${isExpanded ? 'bg-green-50/50' : 'hover:bg-gray-50'}`} onClick={() => toggleGroup(groupKey)}>
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-sm ${isExpired ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                            <i className={`fas ${isExpanded ? 'fa-folder-open' : 'fa-folder'}`}></i>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-black text-gray-900 text-lg">{data.companyName}</span>
                                                {webTenants.some(t => t.ownerId === adminEmail) ? (
                                                    <span className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-1">
                                                        <i className="fab fa-google text-[8px]"></i> WEB SYNC
                                                    </span>
                                                ) : (
                                                    <span className="bg-gray-200 text-gray-500 text-[9px] px-1.5 py-0.5 rounded-md font-bold">OFFLINE ONLY</span>
                                                )}
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${planInfo.color}`}>
                                                    {planInfo.label}
                                                </span>
                                                <span className={`text-xs font-bold ${activeCount > planInfo.max ? 'text-red-500' : 'text-gray-400'}`}>
                                                    (활성 {activeCount} / 최대 {planInfo.max}명)
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500 font-medium">관리자: {data.admin?.userName} ({adminEmail})</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-8">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSyncToWeb(adminEmail, data.admin?.plan || 'ad', data.admin?.expiresAt || null);
                                            }}
                                            disabled={isSyncingWeb}
                                            className="flex flex-col items-center group"
                                        >
                                            <div className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 tracking-wider group-hover:text-blue-500 transition-colors">Sync Web</div>
                                            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all">
                                                <i className={`fas ${isSyncingWeb ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'}`}></i>
                                            </div>
                                        </button>
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 tracking-wider">Payment</div>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                                data.admin?.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 
                                                data.admin?.paymentStatus === 'FREE' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'
                                            }`}>
                                                {data.admin?.paymentStatus === 'PAID' ? '결제완료' : data.admin?.paymentStatus === 'FREE' ? '무료사용' : '미결제'}
                                            </span>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 tracking-wider">Expiry</div>
                                            <div className={`text-sm font-mono font-black ${isExpired ? 'text-red-500' : 'text-gray-700'}`}>
                                                {data.admin?.expiresAt ? new Date(data.admin.expiresAt).toLocaleDateString() : '무제한'}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={(e) => {
                                                e.stopPropagation();
                                                setTargetGroup(adminEmail + "_" + data.companyName);
                                                setModalType('member');
                                                setNewLicense({ role: 'MEMBER', status: LicenseStatus.ACTIVE });
                                                setShowModal(true);
                                            }} className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors" title="직원 추가">
                                                <i className="fas fa-user-plus text-sm"></i>
                                            </button>
                                            <button onClick={(e) => {
                                                e.stopPropagation();
                                                if (data.admin) {
                                                    setNewLicense(data.admin);
                                                    setModalType('group');
                                                    setIsEditing(true);
                                                    setShowModal(true);
                                                } else {
                                                    alert('관리자 정보가 없어 수정할 수 없습니다.');
                                                }
                                            }} className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-200 transition-colors">
                                                <i className="fas fa-cog text-sm"></i>
                                            </button>
                                        </div>
                                        <i className={`fas fa-chevron-right transition-transform text-gray-300 ${isExpanded ? 'rotate-90' : ''}`}></i>
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-gray-100 bg-gray-50/30">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="text-gray-400 border-b border-gray-100">
                                                    <th className="px-6 py-2 text-left font-bold">상태</th>
                                                    <th className="px-6 py-2 text-left font-bold">직책</th>
                                                    <th className="px-6 py-2 text-left font-bold">이름</th>
                                                    <th className="px-6 py-2 text-left font-bold">로그인 ID</th>
                                                    <th className="px-6 py-2 text-left font-bold">비밀번호</th>
                                                    <th className="px-6 py-2 text-center font-bold">최근 접속</th>
                                                    <th className="px-6 py-2 text-right font-bold">관리</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {data.admin && (
                                                    <tr className="bg-indigo-50/50 border-b border-indigo-100/50">
                                                        <td className="px-6 py-3">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); toggleLicenseStatus(data.admin!); }}
                                                                className={`px-2 py-1 rounded-full text-[10px] font-black transition-all ${data.admin.status === LicenseStatus.ACTIVE ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-300 text-white'}`}
                                                            >
                                                                {data.admin.status === LicenseStatus.ACTIVE ? 'ACTIVE' : 'OFF'}
                                                            </button>
                                                        </td>
                                                        <td className="px-6 py-3 font-black text-indigo-600">{data.admin.position || '대표자'}</td>
                                                        <td className="px-6 py-3 font-bold text-gray-900">{data.admin.userName}</td>
                                                        <td className="px-6 py-3 text-gray-500 font-mono font-bold">{data.admin.email}</td>
                                                        <td className="px-6 py-3 text-blue-500 font-bold italic">구글 로그인</td>
                                                        <td className="px-6 py-3 text-center text-blue-600 font-bold">{data.admin.lastCheckIn ? new Date(data.admin.lastCheckIn).toLocaleString() : '미접속'}</td>
                                                        <td className="px-6 py-3 text-right">
                                                            <button onClick={() => handleDelete(data.admin!.id, data.admin!.email)} className="text-red-300 hover:text-red-500"><i className="fas fa-trash-alt"></i></button>
                                                        </td>
                                                    </tr>
                                                )}
                                                {data.members.map(m => (
                                                    <tr key={m.id} className="hover:bg-white transition-colors">
                                                        <td className="px-6 py-3">
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); toggleLicenseStatus(m); }}
                                                                className={`px-2 py-1 rounded-full text-[10px] font-black transition-all ${m.status === LicenseStatus.ACTIVE ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-300 text-white'}`}
                                                            >
                                                                {m.status === LicenseStatus.ACTIVE ? 'ACTIVE' : 'OFF'}
                                                            </button>
                                                        </td>
                                                        <td className="px-6 py-3 text-gray-500 font-bold">{m.position || '직원'}</td>
                                                        <td className="px-6 py-3 font-bold text-gray-700">{m.userName}</td>
                                                        <td className="px-6 py-3 text-gray-500 font-mono">{m.email}</td>
                                                        <td className="px-6 py-3 text-gray-600 font-mono font-bold">{m.password || '-'}</td>
                                                        <td className="px-6 py-3 text-center text-gray-400">{m.lastCheckIn ? new Date(m.lastCheckIn).toLocaleString() : '미접속'}</td>
                                                        <td className="px-6 py-3 text-right">
                                                            <div className="flex justify-end gap-2">
                                                                <button onClick={() => {
                                                                    setTargetGroup(adminEmail + "_" + data.companyName);
                                                                    setNewLicense(m);
                                                                    setModalType('member');
                                                                    setIsEditing(true);
                                                                    setShowModal(true);
                                                                }} className="text-gray-300 hover:text-indigo-500 transition-colors">
                                                                    <i className="fas fa-cog"></i>
                                                                </button>
                                                                <button onClick={() => handleDelete(m.id, m.email)} className="text-gray-300 hover:text-red-500 transition-colors"><i className="fas fa-user-minus"></i></button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {data.members.length === 0 && (
                                                    <tr>
                                                        <td colSpan={7} className="px-6 py-8 text-center text-gray-400 italic font-medium">등록된 직원이 없습니다.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {webTenants
                            .filter(t => !searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.ownerId.toLowerCase().includes(searchTerm.toLowerCase()))
                            .map(tenant => (
                            <div key={tenant.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                                            <i className="fas fa-globe text-lg"></i>
                                        </div>
                                        <div>
                                            <h4 className="font-black text-gray-900">{tenant.name}</h4>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{tenant.id}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                                        tenant.plan === 'pro_plus' ? 'bg-amber-100 text-amber-700' :
                                        tenant.plan === 'pro' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                        {tenant.plan}
                                    </span>
                                </div>
                                <div className="space-y-2 mb-4">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">관리자 이메일</span>
                                        <span className="font-mono font-bold text-gray-700">{tenant.ownerId}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">만료 날짜</span>
                                        <span className="font-bold text-indigo-600">{tenant.licenseExpiresAt ? new Date(tenant.licenseExpiresAt).toLocaleDateString() : '미설정'}</span>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleSyncToWeb(tenant.ownerId, tenant.plan, tenant.licenseExpiresAt || null)}
                                    className="w-full py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-600 hover:text-white transition-all"
                                >
                                    플랜 업데이트 동기화
                                </button>
                            </div>
                        ))}
                        {webTenants.length === 0 && (
                            <div className="col-span-full py-20 text-center text-gray-400 italic">웹에 등록된 회사가 없습니다.</div>
                        )}
                    </div>
                )}
            </div>

            {/* Group/Member Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/20" onClick={e => e.stopPropagation()}>
                        <div className="px-8 py-6 border-b flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h3 className="text-xl font-black text-gray-800">
                                    {modalType === 'group' ? (isEditing ? '그룹 정보 수정' : '신규 그룹 등록') : '직원 추가 등록'}
                                </h3>
                                <p className="text-xs text-gray-400 font-bold mt-1">
                                    {modalType === 'group' ? '회사의 대표 계정과 요금제를 설정합니다.' : `${targetGroup} 그룹에 직원을 추가합니다.`}
                                </p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors text-gray-400"><i className="fas fa-times text-lg"></i></button>
                        </div>
                        
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                    {modalType === 'group' ? 'Google Email (대표자 구글 계정)' : '사내 로그인 ID (Login ID)'}
                                </label>
                                <input 
                                    type="text" 
                                    className={`w-full px-4 py-3 border-2 rounded-2xl text-sm font-black transition-all outline-none ${isEditing && modalType === 'group' ? 'bg-gray-100 border-gray-200 text-gray-500' : 'border-indigo-100 focus:border-indigo-500 text-indigo-600'}`}
                                    placeholder={modalType === 'group' ? "example@gmail.com" : "사내 로그인 아이디 입력"}
                                    value={newLicense.email || ''}
                                    onChange={e => setNewLicense({...newLicense, email: e.target.value})}
                                    readOnly={isEditing && modalType === 'group'}
                                />
                            </div>

                            {modalType === 'member' && (
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Password (로그인 비밀번호)</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-4 py-3 border-2 border-indigo-50/50 bg-indigo-50/10 rounded-2xl text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                                        placeholder="초기 로그인 비밀번호 입력"
                                        value={newLicense.password || ''}
                                        onChange={e => setNewLicense({...newLicense, password: e.target.value})}
                                    />
                                </div>
                            )}

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
                                        placeholder="과장 / 팀장"
                                        value={newLicense.position || ''}
                                        onChange={e => setNewLicense({...newLicense, position: e.target.value})}
                                    />
                                </div>
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
        </div>
    );
};

export default EzPrintWorkLicenseManager;
