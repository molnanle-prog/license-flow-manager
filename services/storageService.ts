
import { Product, Customer, License, LicenseType, LicenseStatus, Order, OrderStatus, AppConfig, ProgramConfig, LicenseRequest, RequestStatus, Installation, PROGRAM_IDS, DebugLog, SmsLog } from '../types';
import { readSheetData, writeSheetData, clearSheetData } from './googleSheetService';
import { syncContactToGoogle } from './contactService';

const STORAGE_KEYS = {
  APP_CONFIG: 'licenseflow_config_v4',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  LICENSES: 'licenses_v2',
  ORDERS: 'orders',
  REQUESTS: 'requests',
  INSTALLATIONS: 'installations_v6', 
  SMS_LOGS: 'sms_logs_v1',
};

const SCHEMAS = {
  PRODUCTS: { headers: ['ID', 'Name', 'Version', 'Sale Price', 'Original Price', 'Description'], keys: ['id', 'name', 'version', 'price', 'originalPrice', 'description'] },
  CUSTOMERS: { headers: ['ID', 'Name', 'Position', 'Email', 'Company', 'Created At'], keys: ['id', 'name', 'position', 'email', 'company', 'createdAt'] },
  LICENSES: { 
    headers: ['License Key', 'PIN', 'Company Name', 'Name / Position', 'Machine ID', 'Expiry Date', 'Status', 'Payment', 'Last Check-in', 'Last Reset', 'Product Name', 'Version', 'Product ID', 'Created At', 'Request ID', 'Contact Info', 'ID', 'Last SMS Sent', 'Payment Date'],
    keys: ['key', 'pin', 'companyName', 'userName', 'machineId', 'expiresAt', 'status', 'paymentStatus', 'lastCheckIn', 'lastReset', 'productName', 'version', 'productId', 'createdAt', 'requestId', 'contactInfo', 'id', 'lastSmsSent', 'paidAt']
  },
  ORDERS: { headers: ['ID', 'Customer ID', 'Product ID', 'Amount', 'Depositor Name', 'Status', 'Created At', 'License ID'], keys: ['id', 'customerId', 'productId', 'amount', 'depositorName', 'status', 'createdAt', 'licenseId'] },
  REQUESTS: { headers: ['날짜', '업체명', '입금자', '연락처', '기기ID', '버전', '상태', 'ID', '제품명'], keys: ['createdAt', 'companyName', 'name', 'contact', 'machineId', 'version', 'status', 'id', 'productName'] },
  INSTALLATIONS: { headers: ['Timestamp', 'CompanyName', 'UserName', 'Contact', 'MachineID', 'ActionType', 'Result', 'IP', 'Version', 'ProductName'], keys: ['timestamp', 'companyName', 'userName', 'contact', 'machineId', 'actionType', 'result', 'ip', 'version', 'productName'] },
  SMS_HISTORY: { headers: ['LicenseKey', 'Timestamp'], keys: ['licenseKey', 'timestamp'] },
  DEBUGLOGS: { headers: ['Timestamp', 'Action', 'MachineId', 'Version', 'RawData'], keys: ['timestamp', 'action', 'machineId', 'version', 'rawData'] },
  SMS_LOGS: { headers: ['날짜', '연락처', '대화내용', '구분', '상태', '라이선스ID'], keys: ['timestamp', 'contact', 'content', 'direction', 'status', 'licenseId'] }
};

const DEFAULT_CONFIG: AppConfig = {
  clientEmail: import.meta.env.VITE_GOOGLE_CLIENT_EMAIL || 'license-admin@license-manager-485501.iam.gserviceaccount.com', 
  privateKey: import.meta.env.VITE_GOOGLE_PRIVATE_KEY || '', 
  programs: [
    { id: 'ezimpo-program', programId: PROGRAM_IDS.EZIMPO, name: 'EzImpo 관리', sheetId: '1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ', productName: 'EzImpo', gasUrl: '', securityToken: 'EzImpo_Secure_Handshake_Token_v3_X9Z' },
    { id: 'ezprintwork-program', programId: PROGRAM_IDS.EZPRINTWORK, name: 'EzPrintWork 관리', sheetId: '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0', productName: 'EzPrintWork', gasUrl: '', securityToken: 'EzImpo_Secure_Handshake_Token_v3_X9Z' }
  ],
  currentProgramId: 'ezimpo-program', emailJsServiceId: '', emailJsTemplateId: '', emailJsPublicKey: '', downloadLink: 'https://naver.me/Fm3SGglJ', enableContactSync: false, googleSubjectEmail: 'asmail774580@gmail.com', integrationSmsSheetId: '1_8EXAEGhqfhZIkuh-pv4SAhUyF5AbiCkxOxlwtTkX3Y',
  solapiApiKey: import.meta.env.VITE_SOLAPI_API_KEY || 'NCSF1S16OROTSM8Q',
  solapiApiSecret: '',
  solapiSenderNumber: '',
};

export const cleanSheetId = (input: string): string => { if (!input) return ''; const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/); return (m && m[1]) ? m[1] : input.trim(); };
let isSettingsRestored = false;

export const getAppConfig = (): AppConfig => { 
  const cfg = localStorage.getItem(STORAGE_KEYS.APP_CONFIG); 
  if (!isSettingsRestored) {
    isSettingsRestored = true;
    // 백그라운드 비동기로 구글 시트 설정 복구 시도
    setTimeout(() => {
      restoreSettingsFromSheet().catch(() => {});
    }, 1000);
  }

  if (cfg) { 
    try { 
      const s = JSON.parse(cfg); 
      const m = { ...DEFAULT_CONFIG, ...s }; 
      DEFAULT_CONFIG.programs.forEach(d => { 
        if (!m.programs.some((p:any)=>p.id===d.id)) m.programs.push(d); 
      }); 
      // 만약 EzPrintWork의 sheetId가 EzImpo의 sheetId와 같은 기본값으로 복제되어 있다면 올바른 기본값으로 패치해줍니다.
      m.programs = m.programs.map(p => {
        if (p.programId === PROGRAM_IDS.EZPRINTWORK && (p.sheetId === '1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ' || !p.sheetId)) {
          return { ...p, sheetId: '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0' };
        }
        return p;
      });
      return m; 
    } catch (e) {} 
  } 
  localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(DEFAULT_CONFIG)); 
  return DEFAULT_CONFIG; 
};

export const saveAppConfig = (config: AppConfig) => {
  localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(config));
  // 저장 시 즉각 구글 시트에도 백그라운드 백업 수행
  saveSettingsToSheet(config).catch(() => {});
};
export const getCurrentProgram = (programId?: PROGRAM_IDS): ProgramConfig | undefined => { const c = getAppConfig(); if (programId) return c.programs.find(p => p.programId === programId); return c.programs.find(p => p.id === c.currentProgramId) || c.programs[0]; };
export const setCurrentProgramId = (id: string) => { const c = getAppConfig(); if (c.programs.find(p => p.id === id)) { c.currentProgramId = id; saveAppConfig(c); } };

export const parseKoreanDate = (dateStr: any): string => {
    if (!dateStr) return '';
    try {
        const str = String(dateStr).trim();
        if (!str || str === '-') return '';
        
        // 1. 이미 ISO 형식인 경우 그대로 반환
        if (str.includes('T') && str.includes('Z')) return str;

        // YYYY-MM-DD HH:mm:ss 형태에서 공백을 T로 치환하여 파싱 성공률 극대화
        let formatted = str;
        if (formatted.includes(' ') && !formatted.includes('T')) {
            formatted = formatted.replace(' ', 'T');
        }

        // 2. 표준 Date 생성 시도
        const d_direct = new Date(formatted);
        if (!isNaN(d_direct.getTime())) return d_direct.toISOString();

        // 3. 한국어 포함 형식 변환 시도
        let clean = str.replace(/\./g, '-').replace('오전', 'AM').replace('오후', 'PM');
        if (clean.includes(' ') && !clean.includes('T')) {
            clean = clean.replace(' ', 'T');
        }
        const d_clean = new Date(clean);
        if (!isNaN(d_clean.getTime())) return d_clean.toISOString();
        
        return str;
    } catch { return String(dateStr || ''); }
};

export const formatDateForSheet = (date: any): string => {
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch (e) { return ''; }
};

const rowToObject = (row: any[], keys: string[]) => {
  const obj: any = {};
  keys.forEach((key, index) => {
    let v = row[index]; if (v === 'null' || v === undefined) v = null;
    else if (!isNaN(Number(v)) && String(v).trim() !== '' && !['machineId', 'contact', 'id', 'version', 'key'].includes(key)) { if (['price', 'amount', 'originalPrice'].includes(key)) v = Number(v); }
    if (key === 'status') { 
        const s = String(v || '').trim().toLowerCase(); 
        if (s === 'processed' || s.includes('완료') || s.includes('처리')) v = 'PROCESSED'; 
        else if (s === 'rejected' || s.includes('거절')) v = 'REJECTED';
        else v = 'PENDING'; // 그 외 모든 값(비어있음, 대기, -, 등)은 대기로 간주
    }
    if (key === 'paymentStatus') { const s = String(v).trim(); if (s === '입금완료' || s === 'PAID') v = 'PAID'; else if (s === '무료사용' || s === 'FREE') v = 'FREE'; else if (s === '체험판' || s === 'TRIAL') v = 'TRIAL'; else v = 'UNPAID'; }
    if (['createdAt', 'expiresAt', 'timestamp', 'lastSmsSent', 'paidAt'].includes(key) && v) v = parseKoreanDate(String(v));
    obj[key] = v;
  });
  return obj;
};

const objectToRow = (obj: any, keys: string[]) => keys.map(key => { 
  let v = obj[key]; 
  if (key === 'paymentStatus') { if (v === 'PAID') return '입금완료'; if (v === 'FREE') return '무료사용'; if (v === 'TRIAL') return '체험판'; return '미입금'; } 
  if (key === 'status') { if (v === 'PENDING') return 'PENDING'; if (v === 'PROCESSED') return 'PROCESSED'; } 
  // 날짜 객체 또는 ISO 문자열인 경우 YYYY-MM-DD HH:mm:ss 형식으로 변환
  if (['createdAt', 'expiresAt', 'timestamp', 'lastSmsSent', 'lastCheckIn', 'lastReset', 'paidAt'].includes(key) && v) {
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D} ${h}:${m}:${s}`;
      }
    } catch (e) {}
  }
  // [FIX] 연락처나 기기 ID 등 앞자리 '0'이 중요한 필드는 문자열로 인식되도록 따옴표 추가
  if (['contact', 'contactInfo', 'machineId', 'pin'].includes(key) && v) {
    const s = String(v).trim();
    return s.startsWith("'") ? s : "'" + s;
  }
  return (v === null || v === undefined) ? '' : String(v); 
});

const getStorageKey = (baseKey: string, p: ProgramConfig) => `${p.sheetId || p.id}_${p.programId}_${baseKey}`;
const MEM_CACHE: Record<string, { timestamp: number, data: any[] }> = {};
export const retry = async <T>(fn: () => Promise<T>, r = 3, d = 2000): Promise<T> => { try { return await fn(); } catch (e) { if (r > 0) { await new Promise(res => setTimeout(res, d)); return retry(fn, r - 1, d * 1.5); } throw e; } };

const loadData = async <T>(baseKey: string, sheetTab: string, schema: { headers: string[], keys: string[] }, force = false, programId?: PROGRAM_IDS): Promise<T[]> => {
  const c = getAppConfig(); const p = getCurrentProgram(programId); if (!p) return [];
  
  // [NEW] SmsLogs 탭이면서 공용 통합 시트 ID가 설정되어 있다면 해당 시트를 타겟으로 삼음
  const targetSheetId = (sheetTab === 'SmsLogs' && c.integrationSmsSheetId) ? c.integrationSmsSheetId : (p.sheetId || '');
  const ck = (sheetTab === 'SmsLogs' && c.integrationSmsSheetId) 
    ? `${c.integrationSmsSheetId}_SmsLogs_${baseKey}` 
    : getStorageKey(`${sheetTab}_${baseKey}`, p);
    
  const now = Date.now();
  if (!force && MEM_CACHE[ck] && (now - MEM_CACHE[ck].timestamp < 60000)) return MEM_CACHE[ck].data as T[];
  if (c.clientEmail && c.privateKey && targetSheetId) {
    try {
      const rows = await retry(() => readSheetData(cleanSheetId(targetSheetId), `'${sheetTab}'!A:Z`, c.clientEmail, c.privateKey));
      if (!Array.isArray(rows)) return [];
      let dr = rows; if (rows.length > 0) { const f = rows[0][0]?.toString().trim().toLowerCase(); if (f === schema.headers[0]?.toLowerCase() || f === 'timestamp' || f === '날짜' || f === 'id') dr = rows.slice(1); }
      const parsed = dr
        .filter(r => r && r.length > 0 && r.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))
        .map(r => rowToObject(r, schema.keys)) as T[];
      localStorage.setItem(ck, JSON.stringify(parsed)); MEM_CACHE[ck] = { timestamp: now, data: parsed }; return parsed;
    } catch (e) { const local = localStorage.getItem(ck); if (local) return JSON.parse(local); throw e; }
  }
  return [];
};

const saveData = async <T>(baseKey: string, sheetTab: string, data: T[], schema: { headers: string[], keys: string[] }, programId?: PROGRAM_IDS): Promise<void> => {
  const c = getAppConfig(); const p = getCurrentProgram(programId); if (!p) return;
  
  // [NEW] SmsLogs 탭이면서 공용 통합 시트 ID가 설정되어 있다면 해당 시트를 타겟으로 삼음
  const targetSheetId = (sheetTab === 'SmsLogs' && c.integrationSmsSheetId) ? c.integrationSmsSheetId : (p.sheetId || '');
  const ck = (sheetTab === 'SmsLogs' && c.integrationSmsSheetId) 
    ? `${c.integrationSmsSheetId}_SmsLogs_${baseKey}` 
    : getStorageKey(`${sheetTab}_${baseKey}`, p);
    
  localStorage.setItem(ck, JSON.stringify(data)); delete MEM_CACHE[ck];
  if (c.clientEmail && c.privateKey && targetSheetId) {
    try { 
        const rows = [schema.headers, ...data.map(item => objectToRow(item, schema.keys))];
        const sId = cleanSheetId(targetSheetId);
        // [SAFE WRITE] 전체를 비우고 쓰는 대신, 먼저 내용을 덮어쓰고 남은 행을 정리합니다.
        await writeSheetData(sId, `'${sheetTab}'!A:Z`, rows, c.clientEmail, c.privateKey);
        // 데이터가 이전보다 줄어든 경우 나머지 행을 비워야 합니다
        if (rows.length < 100) { // 작은 데이터의 경우 안전하게 빈 공간 청소
            const rangeToClear = `'${sheetTab}'!A${rows.length + 1}:Z`;
            await clearSheetData(sId, rangeToClear, c.clientEmail, c.privateKey).catch(() => {});
        }
    } catch (e) { 
        console.error(`Save failed for ${sheetTab}:`, e);
        throw e; 
    }
  }
};

// --- CRUD Functions ---
export const getProducts = async (f = false, pid?: PROGRAM_IDS) => loadData<Product>(STORAGE_KEYS.PRODUCTS, 'Products', SCHEMAS.PRODUCTS, f, pid);
export const getAllProducts = async (f = false) => { const c = getAppConfig(); const res = await Promise.all(c.programs.map(async p => (await getProducts(f, p.programId)).map(i => ({ ...i, programId: p.programId })))); return res.flat(); };
export const saveProduct = async (p: Product, pid?: PROGRAM_IDS) => { const prods = await getProducts(false, pid); const idx = prods.findIndex(x => x.id === p.id); if (idx >= 0) prods[idx] = p; else prods.push(p); await saveData(STORAGE_KEYS.PRODUCTS, 'Products', prods, SCHEMAS.PRODUCTS, pid); };
export const deleteProducts = async (ids: string[], pid?: PROGRAM_IDS) => { const t = new Set(ids); const prods = (await getProducts(false, pid)).filter(p => !t.has(p.id)); await saveData(STORAGE_KEYS.PRODUCTS, 'Products', prods, SCHEMAS.PRODUCTS, pid); };
export const deleteProduct = (id: string, pid?: PROGRAM_IDS) => deleteProducts([id], pid);

export const getCustomers = async (f = false, pid?: PROGRAM_IDS) => loadData<Customer>(STORAGE_KEYS.CUSTOMERS, 'Customers', SCHEMAS.CUSTOMERS, f, pid);
export const getAllCustomers = async (f = false) => { const c = getAppConfig(); const res = await Promise.all(c.programs.map(async p => (await getCustomers(f, p.programId)).map(i => ({ ...i, programId: p.programId })))); return res.flat(); };
export const saveCustomer = async (c: Customer, pid?: PROGRAM_IDS) => { const custs = await getCustomers(false, pid); const idx = custs.findIndex(x => x.id === c.id); if (idx >= 0) custs[idx] = c; else custs.push(c); await saveData(STORAGE_KEYS.CUSTOMERS, 'Customers', custs, SCHEMAS.CUSTOMERS, pid); };
export const findOrCreateCustomer = async (n: string, c: string, cy: string, pid?: PROGRAM_IDS): Promise<Customer> => {
    const custs = await getCustomers(false, pid); 
    const normalizedName = String(n || '').trim().toLowerCase();
    const isGenericName = ['administrator', 'user', 'pc', 'admin', 'laptop', 'desktop'].includes(normalizedName);
    
    // 1. 기존 고객 중 연락처나 회사명이 같은 고객이 있는지 확인
    const ex = custs.find(x => (x.email === c && c !== '') || (x.name === n && x.company === cy)); 
    
    if (ex) {
        // [SHIELD] 만약 기존 고객은 이름이 제대로 되어 있는데, 새로 들어온 이름이 'Administrator' 같은 것이라면 이름을 업데이트하지 않고 반환
        const exNormalized = ex.name.toLowerCase();
        const exIsGeneric = ['administrator', 'user', 'pc', 'admin', 'laptop', 'desktop'].includes(exNormalized);
        
        if (!exIsGeneric && isGenericName) {
            return ex; // 기존의 좋은 이름을 유지
        }
        
        // 만약 기존 이름도 일반적이었는데 새로운 실명이 들어왔다면 업데이트
        if (exIsGeneric && !isGenericName) {
            ex.name = n;
            ex.company = cy || ex.company;
            ex.email = c || ex.email;
            await saveCustomer(ex, pid);
        }
        return ex;
    }
    
    const nc: Customer = { id: `cust-${Date.now()}`, name: n || 'Unknown', email: c || '', company: cy || '', position: '', createdAt: new Date().toISOString() };
    await saveCustomer(nc, pid); return nc;
};

export const getLicenses = async (f = false, pid?: PROGRAM_IDS): Promise<License[]> => {
    const lics = await loadData<License>(STORAGE_KEYS.LICENSES, 'Licenses', SCHEMAS.LICENSES, f, pid);
    return lics.map(l => ({ 
        ...l, 
        id: l.id || `lic-${Math.random().toString(36).substr(2, 9)}`, 
        type: l.expiresAt ? LicenseType.SUBSCRIPTION : LicenseType.LIFETIME, 
        paymentStatus: l.paymentStatus || 'UNPAID' 
    } as License));
};
export const getAllLicenses = async (f = false) => { 
    const c = getAppConfig(); 
    const res = await Promise.all(c.programs.map(async p => (await getLicenses(f, p.programId)).map(i => ({ ...i, programId: p.programId })))); 
    const all = res.flat();
    const seen = new Set<string>();
    return all.filter(lic => {
        const key = lic.key; // License keys are unique
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
export const saveLicense = async (l: License, pid?: PROGRAM_IDS) => { 
    const lics = await getLicenses(false, pid); 
    const idx = lics.findIndex(x => x.id === l.id); 
    if (idx >= 0) lics[idx] = l; else lics.push(l); 
    await saveData(STORAGE_KEYS.LICENSES, 'Licenses', lics, SCHEMAS.LICENSES, pid); 
    if (l.userName || l.companyName) findOrCreateCustomer(l.userName, l.contactInfo, l.companyName, pid).catch(()=>{}); 
};
export const saveLicenses = async (ls: License[], pid?: PROGRAM_IDS) => { 
    const lics = await getLicenses(false, pid); 
    ls.forEach(x => { const idx = lics.findIndex(y => y.id === x.id); if (idx >= 0) lics[idx] = x; else lics.push(x); }); 
    await saveData(STORAGE_KEYS.LICENSES, 'Licenses', lics, SCHEMAS.LICENSES, pid); 
};
export const deleteLicenses = async (ids: string[], pid?: PROGRAM_IDS) => { 
    const t = new Set(ids); 
    const lics = (await getLicenses(false, pid)).filter(l => !t.has(l.id)); 
    await saveData(STORAGE_KEYS.LICENSES, 'Licenses', lics, SCHEMAS.LICENSES, pid); 
};
export const deleteLicense = (id: string, pid?: PROGRAM_IDS) => deleteLicenses([id], pid);

/**
 * [데이터 복구] 제품명을 기준으로 잘못된 Product ID를 자동 교정합니다.
 * - 구버전 GAS 스크립트에 의해 하드코딩된 '1769414458305' 등의 값을 정상화합니다.
 */
export const repairLicenseProductIds = async (pid?: PROGRAM_IDS): Promise<{ total: number, repaired: number }> => {
    const lics = await getLicenses(true, pid);
    const prods = await getProducts(true, pid);
    let repairedCount = 0;

    const updatedLics = lics.map(lic => {
        const matchingProd = prods.find(p => 
            p.name.trim().toLowerCase() === String(lic.productName || '').trim().toLowerCase()
        );

        if (matchingProd && lic.productId !== matchingProd.id) {
            repairedCount++;
            return { ...lic, productId: matchingProd.id };
        }
        return lic;
    });

    if (repairedCount > 0) {
        await saveLicenses(updatedLics, pid);
    }

    return { total: lics.length, repaired: repairedCount };
};

export const generateSerialKey = (p = 'KEY'): string => { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let r = p + '-'; for (let i = 0; i < 3; i++) { for (let j = 0; j < 4; j++) { r += c.charAt(Math.floor(Math.random() * c.length)); } if (i < 2) r += '-'; } return r; };

export const getOrders = async (f = false, pid?: PROGRAM_IDS) => loadData<Order>(STORAGE_KEYS.ORDERS, 'Orders', SCHEMAS.ORDERS, f, pid);
export const saveOrder = async (o: Order, pid?: PROGRAM_IDS) => { const ords = await getOrders(false, pid); const idx = ords.findIndex(x => x.id === o.id); if (idx >= 0) ords[idx] = o; else ords.push(o); await saveData(STORAGE_KEYS.ORDERS, 'Orders', ords, SCHEMAS.ORDERS, pid); };
export const deleteOrder = async (id: string, pid?: PROGRAM_IDS) => { const ords = (await getOrders(false, pid)).filter(o => o.id !== id); await saveData(STORAGE_KEYS.ORDERS, 'Orders', ords, SCHEMAS.ORDERS, pid); };

// [INTERNAL] 필터링 없는 원본 신청 내역 로드 (CRUD용)
export const getRawLicenseRequests = async (f = false, pid?: PROGRAM_IDS) => { 
  const newReqs = await loadData<LicenseRequest>(STORAGE_KEYS.REQUESTS, 'Order', SCHEMAS.REQUESTS, f, pid); 
  const oldReqs = await loadData<LicenseRequest>(STORAGE_KEYS.REQUESTS + '_old', 'PurchaseRequests', SCHEMAS.REQUESTS, f, pid).catch(() => []);
  return [...newReqs, ...oldReqs];
};

export const getLicenseRequests = async (f = false, pid?: PROGRAM_IDS) => { 
  const p = getCurrentProgram(pid);
  const reqs = await getRawLicenseRequests(f, pid); 
  
  // 1. 필요한 정보 맵핑 및 보완 (결정론적 ID 생성)
  const mapped = reqs.map(r => {
      // [FIX] 시트에 ID가 없는 경우, 로드할 때마다 동일한 ID를 갖도록 날짜/기기/이름 조합 사용
      // [FIX] 초/밀리초 제외하여 ID 일관성 확보 (YYYYMMDDHHMM 형식만 사용)
      const datePart = String(r.createdAt || '').replace(/[^0-9]/g, '').substring(0, 12);
      const deterministicId = r.id || `req-${datePart}-${String(r.name || '').trim()}-${String(r.machineId || '').trim()}`;
      return { 
          ...r, 
          id: deterministicId,
          productName: r.productName || '' 
      };
  });

  // 2. 제품명 기준 스트릭트 필터링 강화
  const cleanStr = (s: any) => String(s || '').replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
  const currentProgId = p?.programId;
  const currentProgProduct = cleanStr(p?.productName || '');

  const filtered = mapped.filter(r => {
      const reqProduct = cleanStr(r.productName);
      
      // [LENIENT] 제품명이 없거나 '-'인 경우 현재 프로그램 시트에서 읽어온 것이면 무조건 표시
      if (reqProduct === '-' || reqProduct === '') return true;
      
      // [RELAXED FILTER] 제품명이 '-' 이거나 매우 짧은 경우, 혹은 현재 프로그램 제품명을 포함하는 경우 모두 허용
      if (reqProduct === '-' || reqProduct === '') return true;

      // 프로그램 ID가 명시적으로 다르면 탈락 (동일 시트 공유 시에도 식별 가능하도록)
      const isMatch = reqProduct.includes(currentProgProduct) || currentProgProduct.includes(reqProduct);
      
      // EzPrintWork와 EzImpo 간의 혼동 방지 (상호 배타적 체크는 유지하되, 제품명이 확실할 때만 작동)
      if (currentProgId === PROGRAM_IDS.EZIMPO && reqProduct.includes('printwork')) return false;
      if (currentProgId === PROGRAM_IDS.EZPRINTWORK && (reqProduct.includes('impo') || reqProduct.includes('임포'))) return false;

      return isMatch || currentProgProduct === '';
  });

  // [FIX] 중복 제거 로직 적용 (PROCESSED 상태 우선순위 부여)
  // 단일 프로그램을 가져올 때도 시트 내 중복 행이 있으면 하나로 합쳐서 카운트해야 함
  const seenMap = new Map<string, LicenseRequest>();
  filtered.forEach(req => {
      const existing = seenMap.get(req.id);
      if (!existing || (existing.status !== RequestStatus.PROCESSED && req.status === RequestStatus.PROCESSED)) {
          seenMap.set(req.id, req);
      }
  });

  return Array.from(seenMap.values());
};
export const getAllLicenseRequests = async (f = false) => { 
    const c = getAppConfig(); 
    const results = await Promise.all(c.programs.map(async p => {
        try {
            const reqs = await getLicenseRequests(f, p.programId);
            return reqs.map(i => ({ ...i, programId: p.programId }));
        } catch (e) {
            console.error(`Failed to load requests for ${p.name}:`, e);
            return []; // 개별 프로그램 로드 실패 시 빈 배열 반환하여 전체 중단 방지
        }
    }));
    
    const all = results.flat();
    const finalMap = new Map<string, LicenseRequest & { programId: PROGRAM_IDS }>();
    all.forEach(req => {
        const key = `${req.id}_${req.programId}`;
        finalMap.set(key, req);
    });
    return Array.from(finalMap.values());
};
export const saveLicenseRequest = async (r: LicenseRequest, pid?: PROGRAM_IDS) => { 
    // [FIX] 저장할 때마다 전체 시트 데이터를 로드하여 중복을 정리(Cleanup)한 후 저장합니다.
    const raw = await getRawLicenseRequests(true, pid); 
    
    // 1. 모든 행에 결정론적 ID 부여 및 정규화
    const mapped = raw.map(item => {
        const datePart = String(item.createdAt || '').replace(/[^0-9]/g, '').substring(0, 12);
        const deterministicId = item.id || `req-${datePart}-${String(item.name || '').trim()}-${String(item.machineId || '').trim()}`;
        return { ...item, id: deterministicId };
    });

    // 2. 현재 요청 추가 또는 업데이트
    const targetId = r.id;
    const existingIdx = mapped.findIndex(m => m.id === targetId);
    if (existingIdx !== -1) {
        mapped[existingIdx] = { ...mapped[existingIdx], ...r };
    } else {
        mapped.push(r);
    }

    // 3. 전체 데이터 중복 제거 (PROCESSED 상태 우선)
    const finalMap = new Map<string, LicenseRequest>();
    mapped.forEach(req => {
        const existing = finalMap.get(req.id);
        if (!existing || (existing.status !== RequestStatus.PROCESSED && req.status === RequestStatus.PROCESSED)) {
            finalMap.set(req.id, req);
        }
    });

    const cleaned = Array.from(finalMap.values());
    await saveData(STORAGE_KEYS.REQUESTS, 'Order', cleaned, SCHEMAS.REQUESTS, pid); 
};
export const deleteLicenseRequest = async (id: string, pid?: PROGRAM_IDS) => { 
    // [FIX] 중복된 모든 논리적 행을 한꺼번에 제거하기 위해 정제 후 필터링합니다.
    const raw = await getRawLicenseRequests(true, pid); 
    
    const remaining = raw.filter(item => {
        const datePart = String(item.createdAt || '').replace(/[^0-9]/g, '').substring(0, 12);
        const deterministicId = item.id || `req-${datePart}-${String(item.name || '').trim()}-${String(item.machineId || '').trim()}`;
        // 전달받은 ID와 일치하거나, 논리적으로 생성된 ID가 일치하면 삭제 대상으로 간주
        return item.id !== id && deterministicId !== id;
    });

    await saveData(STORAGE_KEYS.REQUESTS, 'Order', remaining, SCHEMAS.REQUESTS, pid); 
};

export const getInstallations = async (f = false, pid?: PROGRAM_IDS) => { const insts = await loadData<Installation>(STORAGE_KEYS.INSTALLATIONS, 'InstallLogs', SCHEMAS.INSTALLATIONS, f, pid); return insts.map(i => ({ ...i, id: i.id || `inst-${Math.random().toString(36).substr(2, 9)}` })); };
export const getAllInstallations = async (f = false) => { 
    const c = getAppConfig(); 
    const res = await Promise.all(c.programs.map(async p => (await getInstallations(f, p.programId)).map(i => ({ ...i, programId: p.programId })))); 
    const all = res.flat();
    const seen = new Set<string>();
    return all.filter(inst => {
        const key = `${inst.timestamp}_${inst.machineId}_${inst.userName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
export const saveInstallations = async (is: Installation[], pid?: PROGRAM_IDS) => saveData(STORAGE_KEYS.INSTALLATIONS, 'InstallLogs', is, SCHEMAS.INSTALLATIONS, pid);

export const forceSyncLicenses = async (pid?: PROGRAM_IDS) => { const c = getAppConfig(); const p = getCurrentProgram(pid); if (!p) throw new Error("Program not found"); await getLicenses(true, pid); };
export const syncCustomersFromLicenses = async (pid?: PROGRAM_IDS) => { const lics = await getLicenses(true, pid); const custs = await getCustomers(true, pid); let added = 0; for (const l of lics) { if (!l.userName && !l.companyName) continue; await findOrCreateCustomer(l.userName, l.contactInfo, l.companyName, pid); added++; } return { total: added, added: added }; };

export const getSmsHistory = async (f = false, pid?: PROGRAM_IDS) => { const data = await loadData<any>('sms_history', 'SmsHistory', SCHEMAS.SMS_HISTORY, f, pid); const h: Record<string, number> = {}; data.forEach((i:any) => { if (i.licenseKey) h[i.licenseKey] = Number(i.timestamp); }); return h; };
export const saveSmsHistory = async (h: Record<string, number>, pid?: PROGRAM_IDS) => { const data = Object.entries(h).map(([k, v]) => ({ licenseKey: k, timestamp: v })); await saveData('sms_history', 'SmsHistory', data, SCHEMAS.SMS_HISTORY, pid); };

export const getDebugLogs = (force = false) => loadData<DebugLog>('debuglogs', 'DebugLogs', SCHEMAS.DEBUGLOGS, force);
export const clearDebugLogs = async (): Promise<void> => {
  const c = getAppConfig();
  const p = getCurrentProgram();
  if (!p || !c.clientEmail || !c.privateKey || !p.sheetId) return;
  
  const ck = getStorageKey('DebugLogs_debuglogs', p);
  try {
    // 헤더('Timestamp', 'Action', 'MachineId', 'Version', 'RawData')를 제외한 데이터 영역 삭제
    // A2:Z 범위 삭제
    await clearSheetData(cleanSheetId(p.sheetId), 'DebugLogs!A2:Z', c.clientEmail, c.privateKey);
    localStorage.removeItem(ck);
    delete MEM_CACHE[ck];
  } catch (e) {
    console.error("Failed to clear debug logs from sheet:", e);
    throw e;
  }
};

// [NEW] 통합 구글 시트 SMS 로그 읽기
export const getSmsLogsFromSheet = async (force = false, programId?: PROGRAM_IDS): Promise<SmsLog[]> => {
  try {
    const list = await loadData<any>(STORAGE_KEYS.SMS_LOGS, 'SmsLogs', SCHEMAS.SMS_LOGS, force, programId);
    return list.map((item: any, idx: number) => ({
      id: `sms-${new Date(item.timestamp).getTime() || Date.now()}-${idx}`,
      contact: String(item.contact || '').replace(/'/g, ''),
      content: item.content || '',
      direction: item.direction || 'OUTBOUND',
      status: item.status || 'SUCCESS',
      licenseId: item.licenseId || undefined,
      timestamp: item.timestamp || new Date().toISOString()
    } as SmsLog));
  } catch (e) {
    console.error("Failed to load SMS logs from sheet:", e);
    return [];
  }
};

// [NEW] 통합 구글 시트 SMS 로그 저장
export const saveSmsLogToSheet = async (log: Omit<SmsLog, 'id'>, programId?: PROGRAM_IDS): Promise<void> => {
  try {
    const list = await getSmsLogsFromSheet(false, programId);
    
    const newLogItem = {
      timestamp: log.timestamp || new Date().toISOString(),
      contact: log.contact,
      content: log.content,
      direction: log.direction,
      status: log.status,
      licenseId: log.licenseId || ''
    };
    
    list.push(newLogItem as any);
    await saveData(STORAGE_KEYS.SMS_LOGS, 'SmsLogs', list, SCHEMAS.SMS_LOGS, programId);
  } catch (e) {
    console.error("Failed to save SMS log to sheet:", e);
    throw e;
  }
};

/**
 * [Settings] 구글 시트 Settings 탭에 환경 설정(Solapi 키, 발신번호 등)을 실시간 저장합니다.
 */
export const saveSettingsToSheet = async (config: AppConfig): Promise<void> => {
  const p = getCurrentProgram();
  if (!p || !config.clientEmail || !config.privateKey || !p.sheetId) return;

  const settingsToBackup = [
    { key: 'solapiApiKey', value: config.solapiApiKey || '' },
    { key: 'solapiApiSecret', value: config.solapiApiSecret || '' },
    { key: 'solapiSenderNumber', value: config.solapiSenderNumber || '' },
    { key: 'downloadLink', value: config.downloadLink || '' },
    { key: 'enableContactSync', value: config.enableContactSync ? 'true' : 'false' },
    { key: 'googleSubjectEmail', value: config.googleSubjectEmail || '' },
    { key: 'emailJsServiceId', value: config.emailJsServiceId || '' },
    { key: 'emailJsTemplateId', value: config.emailJsTemplateId || '' },
    { key: 'emailJsPublicKey', value: config.emailJsPublicKey || '' },
    { key: 'integrationSmsSheetId', value: config.integrationSmsSheetId || '' }
  ];

  try {
    const sId = cleanSheetId(p.sheetId);
    const rows = [['ConfigKey', 'ConfigValue'], ...settingsToBackup.map(item => [item.key, item.value])];
    await writeSheetData(sId, `'Settings'!A:B`, rows, config.clientEmail, config.privateKey);
    console.log('[storageService] Settings successfully backed up to Google Sheet.');
  } catch (err) {
    console.error('[storageService] Failed to backup settings to Google Sheet:', err);
  }
};

/**
 * [Settings] 구글 시트 Settings 탭으로부터 누락된 환경 설정 정보를 백그라운드 로드하여 복구합니다.
 */
export const restoreSettingsFromSheet = async (): Promise<boolean> => {
  const localConfig = getAppConfig();
  const p = getCurrentProgram();
  if (!p || !localConfig.clientEmail || !localConfig.privateKey || !p.sheetId) return false;

  try {
    const sId = cleanSheetId(p.sheetId);
    const rows = await readSheetData(sId, `'Settings'!A:B`, localConfig.clientEmail, localConfig.privateKey);
    if (!Array.isArray(rows) || rows.length <= 1) return false;

    const sheetSettings: Record<string, string> = {};
    rows.slice(1).forEach(row => {
      if (row && row[0]) {
        sheetSettings[row[0].toString().trim()] = row[1] ? row[1].toString().trim() : '';
      }
    });

    let isUpdated = false;
    const updatedConfig = { ...localConfig };

    const keysToRestore = [
      'solapiApiKey', 'solapiApiSecret', 'solapiSenderNumber', 
      'downloadLink', 'googleSubjectEmail', 
      'emailJsServiceId', 'emailJsTemplateId', 'emailJsPublicKey', 
      'integrationSmsSheetId'
    ];

    keysToRestore.forEach(key => {
      if (sheetSettings[key] !== undefined && sheetSettings[key] !== (localConfig as any)[key]) {
        (updatedConfig as any)[key] = sheetSettings[key];
        isUpdated = true;
      }
    });

    if (sheetSettings['enableContactSync'] !== undefined) {
      const boolVal = sheetSettings['enableContactSync'] === 'true';
      if (boolVal !== localConfig.enableContactSync) {
        updatedConfig.enableContactSync = boolVal;
        isUpdated = true;
      }
    }

    if (isUpdated) {
      localStorage.setItem(STORAGE_KEYS.APP_CONFIG, JSON.stringify(updatedConfig));
      console.log('[storageService] Settings successfully restored from Google Sheet to LocalStorage.');
      window.dispatchEvent(new CustomEvent('REFRESH_DATA'));
      return true;
    }
  } catch (err) {
    console.warn('[storageService] Background settings restore failed:', err);
  }
  return false;
};

/**
 * [NEW] Call Google Apps Script WebApp URL for program-specific actions
 */
export const callGAS = async (programId: PROGRAM_IDS, action: string, data: any): Promise<any> => {
  const p = getCurrentProgram(programId);
  if (!p || !p.gasUrl) {
    console.warn(`No GAS URL found for program: ${programId}`);
    return null;
  }

  try {
    const response = await fetch(p.gasUrl, {
      method: 'POST',
      body: JSON.stringify({
        action,
        token: p.securityToken || '',
        ...data
      })
    });
    
    if (!response.ok) throw new Error(`GAS Error: ${response.statusText}`);
    return await response.json();
  } catch (err) {
    console.error(`Failed to call GAS (${action}):`, err);
    throw err;
  }
};
