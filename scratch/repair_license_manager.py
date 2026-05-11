
import os

filepath = r'c:\Users\CEO\Desktop\라이선스-플로우-매니저(메일-보내기-기능-업그레이드)\components\LicenseManager.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State addition
old_state = """  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'product' | 'license', id: string, name: string } | null>(null);"""

new_state = """  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'product' | 'license', id: string, name: string } | null>(null);

  // [NEW] Sort State
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'createdAt', direction: 'desc' });

  const handleSort = (key: string) => {
      setSortConfig(prev => {
          if (prev?.key === key) {
              return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
          }
          return { key, direction: 'asc' };
      });
  };"""

content = content.replace(old_state, new_state)

# 2. compareVersions modification
old_compare = """  const compareVersions = useCallback((v1: string, v2: string) => {
      if (!v1 || !v2) return 0;
      const p1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
      const p2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
          const n1 = p1[i] || 0;
          const n2 = p2[i] || 0;
          if (n1 > n2) return 1;
          if (n1 < n2) return -1;
      }
      return 0;
  }, []);"""

new_compare = """  const compareVersions = useCallback((v1: string, v2: string) => {
      if (!v1 && !v2) return 0;
      if (!v1) return -1;
      if (!v2) return 1;
      
      const p1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
      const p2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);
      
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
          const n1 = p1[i] || 0;
          const n2 = p2[i] || 0;
          if (n1 > n2) return 1;
          if (n1 < n2) return -1;
      }
      return 0;
  }, []);"""

content = content.replace(old_compare, new_compare)

# 3. RenderTable modification
old_render = r'''  const RenderTable = ({ data, showCheckboxes = true, isConverted = false }: { data: License[], showCheckboxes?: boolean, isConverted?: boolean }) => (
       <table className="w-full text-center border-collapse" style={{ tableLayout: 'fixed' }}>
           <colgroup>
               <col style={{ width: 40 }} />
               {COLUMN_DEFS.map(col => <col key={col.id} style={{ width: colWidths[col.id] || col.width }} />)}
           </colgroup>
           <thead className={`text-[11px] uppercase sticky top-0 shadow-sm z-10 select-none ${isConverted ? 'bg-blue-100 text-blue-900 border-b border-blue-200' : 'bg-gray-50 text-gray-700 border-b border-gray-200'}`}>
               <tr>
                   <th className="px-1 py-1 text-center border-r border-gray-200/50">
                       {showCheckboxes && <input type="checkbox" checked={selectedIds.size === data.length && data.length > 0} onChange={() => handleSelectAll(data.map(l => l.id))} />}
                   </th>
                   {COLUMN_DEFS.map(col => (
                       <th key={col.id} className="px-1 py-1 font-medium relative group truncate text-center border-r border-gray-200/50 last:border-r-0">
                           {col.label}
                           <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 group-hover:bg-gray-300" onMouseDown={(e) => { setResizing({ id: col.id, startX: e.clientX, startWidth: colWidths[col.id] || col.width }); e.preventDefault(); }} />
                       </th>
                   ))}
               </tr>
           </thead>
           <tbody className={`divide-y divide-gray-100 text-xs`}>
               {data.map((l, idx) => {
                   const prod = products.find(p => p.id === l.productId);
                   const isGhost = l.id.startsWith('ghost-');
                   const isNew = isWithin24Hours(l.createdAt);
                   const isExpired = l.expiresAt && new Date(l.expiresAt) < new Date();
                   const rowClass = isConverted ? 'bg-blue-50/50 text-gray-900 hover:bg-blue-100/50' : `hover:bg-gray-50 ${isExpired ? 'bg-red-50/30' : isGhost ? 'bg-yellow-50/20' : ''}`;
                   
                   return (
                       <tr key={l.id} className={rowClass}>
                           <td className="px-1 py-1 text-center border-r border-gray-200/50">
                               {showCheckboxes && <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelection(l.id)} />}
                           </td>
                           {COLUMN_DEFS.map(col => {
                               const value = l[col.id as keyof License];
                               switch(col.id) {
                                   case 'index':
                                       return <td key={col.id} className="px-1 py-0.5 text-center text-gray-400 border-r border-gray-200/50">{idx + 1}</td>;
                                   case 'key':
                                       return <td key={col.id} className="px-1 py-0.5 font-mono text-[10px] text-indigo-600 truncate border-r border-gray-200/50" title={String(value || '')}>{String(value || '-')}</td>;
                                   case 'userName':
                                       return (
                                           <td key={col.id} className="px-1 py-0.5 font-bold text-gray-900 truncate border-r border-gray-200/50">
                                               {l.userName} {isNew && <span className="ml-1 bg-red-500 text-white text-[9px] px-1 rounded animate-pulse">NEW</span>}
                                           </td>
                                       );
                                   case 'machineId':
                                       return <td key={col.id} className="px-1 py-0.5 font-mono text-[10px] text-gray-600 truncate border-r border-gray-200/50" title={l.machineId}>{l.machineId || '-'}</td>;
                                   case 'expiresAt':
                                       return <td key={col.id} className={`px-1 py-0.5 border-r border-gray-200/50 ${isExpired && !isConverted ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{l.expiresAt ? l.expiresAt.substring(0, 10) : '∞'}</td>;
                                   case 'status':
                                       return (
                                           <td key={col.id} className="px-1 py-0.5 border-r border-gray-200/50 text-center">
                                               {isGhost ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isConverted ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-orange-100 text-orange-700'}`}>{isConverted ? '전환됨' : 'AUTO-TRIAL'}</span> : <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.status === 'ACTIVE' && !isConverted ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>{l.status}</span>}
                                           </td>
                                       );
                                   case 'smsStatus':
                                       const lastSent = smsHistory[l.key || l.id];
                                       return (
                                           <td key={col.id} className="px-1 py-0.5 text-center border-r border-gray-200/50">
                                               {lastSent ? <span className="text-[10px] text-green-600 font-bold"><i className="fas fa-check-circle mr-1"></i>{new Date(lastSent).toLocaleDateString().slice(5)}</span> : <span className="text-[10px] text-gray-300">-</span>}
                                           </td>
                                       );
                                   case 'actions':
                                       return (
                                           <td key={col.id} className="px-1 py-0.5 text-center">
                                               {isGhost ? (
                                                   !isConverted && <button onClick={() => { setModalType('license'); setIsEditing(false); setNewLicense({ userName: l.userName, companyName: l.companyName, contactInfo: l.contactInfo, machineId: l.machineId, productName: l.productName, productId: prod ? prod.id : '', status: LicenseStatus.ACTIVE, paymentStatus: 'PAID' }); setSelectedDuration('LIFETIME'); setShowModal(true); }} className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-indigo-700 whitespace-nowrap shadow-sm">정품 등록</button>
                                               ) : (
                                                   <div className="flex justify-center opacity-80 hover:opacity-100">
                                                       <button onClick={() => openSmsModal(l)} className="text-green-600 hover:text-green-800 mx-1" title="일반 문자 보내기"><i className="fas fa-comment-dots"></i></button>
                                                       <button onClick={() => { setModalType('license'); setIsEditing(true); setNewLicense(l); if (l.expiresAt) { setSelectedDuration('CUSTOM'); setCustomExpiryDate(l.expiresAt.substring(0, 10)); } else { setSelectedDuration('LIFETIME'); setCustomExpiryDate(''); } setShowModal(true); }} className="text-gray-500 hover:text-indigo-700 mx-1"><i className="fas fa-edit"></i></button>
                                                       <button onClick={() => promptDelete('license', l.id, l.key)} className="text-gray-500 hover:text-red-700 mx-1"><i className="fas fa-trash"></i></button>
                                                   </div>
                                               )}
                                           </td>
                                       );
                                   default:
                                       return <td key={col.id} className={`px-1 py-0.5 truncate text-gray-600 text-[11px] border-r border-gray-200/50 last:border-r-0 ${col.id === 'companyName' ? 'text-left' : ''}`} title={String(value || '')}>{String(value || '-')}</td>;
                               }
                           })}
                       </tr>
                   );
               })}
           </tbody>
       </table>
   );'''

new_render = r'''  const RenderTable = ({ data, showCheckboxes = true, isConverted = false }: { data: License[], showCheckboxes?: boolean, isConverted?: boolean }) => {
       const sortedData = useMemo(() => {
           if (!sortConfig) return data;
           
           return [...data].sort((a, b) => {
               const { key, direction } = sortConfig;
               let valA: any = a[key as keyof License];
               let valB: any = b[key as keyof License];

               // Special case for version sorting (use live version)
               if (key === 'version') {
                   valA = getVersionStatus(a).current;
                   valB = getVersionStatus(b).current;
                   const cmp = compareVersions(valA, valB);
                   return direction === 'asc' ? cmp : -cmp;
               }

               // General string/number comparison
               if (valA === valB) return 0;
               if (!valA) return direction === 'asc' ? -1 : 1;
               if (!valB) return direction === 'asc' ? 1 : -1;

               const cmp = valA < valB ? -1 : 1;
               return direction === 'asc' ? cmp : -cmp;
           });
       }, [data, sortConfig, getVersionStatus, compareVersions]);

       return (
           <table className="w-full text-center border-collapse" style={{ tableLayout: 'fixed' }}>
               <colgroup>
                   <col style={{ width: 40 }} />
                   {COLUMN_DEFS.map(col => <col key={col.id} style={{ width: colWidths[col.id] || col.width }} />)}
               </colgroup>
               <thead className={`text-[11px] uppercase sticky top-0 shadow-sm z-10 select-none ${isConverted ? 'bg-blue-100 text-blue-900 border-b border-blue-200' : 'bg-gray-50 text-gray-700 border-b border-gray-200'}`}>
                   <tr>
                       <th className="px-1 py-1 text-center border-r border-gray-200/50">
                           {showCheckboxes && <input type="checkbox" checked={selectedIds.size === data.length && data.length > 0} onChange={() => handleSelectAll(data.map(l => l.id))} />}
                       </th>
                       {COLUMN_DEFS.map(col => (
                           <th 
                               key={col.id} 
                               className={`px-1 py-1 font-medium relative group truncate text-center border-r border-gray-200/50 last:border-r-0 cursor-pointer hover:bg-gray-100 transition-colors ${sortConfig?.key === col.id ? 'bg-gray-100 text-indigo-600' : ''}`}
                               onClick={() => handleSort(col.id)}
                           >
                               <div className="flex items-center justify-center gap-1">
                                   {col.label}
                                   {sortConfig?.key === col.id && (
                                       <i className={`fas fa-sort-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-[10px]`}></i>
                                   )}
                               </div>
                               <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 group-hover:bg-gray-300" onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: col.id, startX: e.clientX, startWidth: colWidths[col.id] || col.width }); e.preventDefault(); }} />
                           </th>
                       ))}
                   </tr>
               </thead>
               <tbody className={`divide-y divide-gray-100 text-xs`}>
                   {sortedData.map((l, idx) => {
                       const prod = products.find(p => p.id === l.productId);
                       const isGhost = l.id.startsWith('ghost-');
                       const isNew = isWithin24Hours(l.createdAt);
                       const isExpired = l.expiresAt && new Date(l.expiresAt) < new Date();
                       const rowClass = isConverted ? 'bg-blue-50/50 text-gray-900 hover:bg-blue-100/50' : `hover:bg-gray-50 ${isExpired ? 'bg-red-50/30' : isGhost ? 'bg-yellow-50/20' : ''}`;
                       
                       return (
                           <tr key={l.id} className={rowClass}>
                               <td className="px-1 py-1 text-center border-r border-gray-200/50">
                                   {showCheckboxes && <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelection(l.id)} />}
                               </td>
                               {COLUMN_DEFS.map(col => {
                                   const value = l[col.id as keyof License];
                                   switch(col.id) {
                                       case 'index':
                                           return <td key={col.id} className="px-1 py-0.5 text-center text-gray-400 border-r border-gray-200/50">{idx + 1}</td>;
                                       case 'key':
                                           return <td key={col.id} className="px-1 py-0.5 font-mono text-[10px] text-indigo-600 truncate border-r border-gray-200/50" title={String(value || '')}>{String(value || '-')}</td>;
                                       case 'userName':
                                           return (
                                               <td key={col.id} className="px-1 py-0.5 font-bold text-gray-900 truncate border-r border-gray-200/50">
                                                   {l.userName} {isNew && <span className="ml-1 bg-red-500 text-white text-[9px] px-1 rounded animate-pulse">NEW</span>}
                                               </td>
                                           );
                                       case 'machineId':
                                           return <td key={col.id} className="px-1 py-0.5 font-mono text-[10px] text-gray-600 truncate border-r border-gray-200/50" title={l.machineId}>{l.machineId || '-'}</td>;
                                       case 'expiresAt':
                                           return <td key={col.id} className={`px-1 py-0.5 border-r border-gray-200/50 ${isExpired && !isConverted ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{l.expiresAt ? l.expiresAt.substring(0, 10) : '∞'}</td>;
                                       case 'status':
                                           return (
                                               <td key={col.id} className="px-1 py-0.5 border-r border-gray-200/50 text-center">
                                                   {isGhost ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isConverted ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-orange-100 text-orange-700'}`}>{isConverted ? '전환됨' : 'AUTO-TRIAL'}</span> : <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.status === 'ACTIVE' && !isConverted ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>{l.status}</span>}
                                               </td>
                                           );
                                       case 'smsStatus':
                                           const lastSent = smsHistory[l.key || l.id];
                                           return (
                                               <td key={col.id} className="px-1 py-0.5 text-center border-r border-gray-200/50">
                                                   {lastSent ? <span className="text-[10px] text-green-600 font-bold"><i className="fas fa-check-circle mr-1"></i>{new Date(lastSent).toLocaleDateString().slice(5)}</span> : <span className="text-[10px] text-gray-300">-</span>}
                                               </td>
                                           );
                                       case 'actions':
                                           return (
                                               <td key={col.id} className="px-1 py-0.5 text-center">
                                                   {isGhost ? (
                                                       !isConverted && <button onClick={() => { setModalType('license'); setIsEditing(false); setNewLicense({ userName: l.userName, companyName: l.companyName, contactInfo: l.contactInfo, machineId: l.machineId, productName: l.productName, productId: prod ? prod.id : '', status: LicenseStatus.ACTIVE, paymentStatus: 'PAID' }); setSelectedDuration('LIFETIME'); setShowModal(true); }} className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-indigo-700 whitespace-nowrap shadow-sm">정품 등록</button>
                                                   ) : (
                                                       <div className="flex justify-center opacity-80 hover:opacity-100">
                                                           <button onClick={() => openSmsModal(l)} className="text-green-600 hover:text-green-800 mx-1" title="일반 문자 보내기"><i className="fas fa-comment-dots"></i></button>
                                                           <button onClick={() => { setModalType('license'); setIsEditing(true); setNewLicense(l); if (l.expiresAt) { setSelectedDuration('CUSTOM'); setCustomExpiryDate(l.expiresAt.substring(0, 10)); } else { setSelectedDuration('LIFETIME'); setCustomExpiryDate(''); } setShowModal(true); }} className="text-gray-500 hover:text-indigo-700 mx-1"><i className="fas fa-edit"></i></button>
                                                           <button onClick={() => promptDelete('license', l.id, l.key)} className="text-gray-500 hover:text-red-700 mx-1"><i className="fas fa-trash"></i></button>
                                                       </div>
                                                   )}
                                               </td>
                                           );
                                       default:
                                           return <td key={col.id} className={`px-1 py-0.5 truncate text-gray-600 text-[11px] border-r border-gray-200/50 last:border-r-0 ${col.id === 'companyName' ? 'text-left' : ''}`} title={String(value || '')}>{String(value || '-')}</td>;
                                   }
                               })}
                           </tr>
                       );
                   })}
               </tbody>
           </table>
       );
  };'''

content = content.replace(old_render, new_render)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
