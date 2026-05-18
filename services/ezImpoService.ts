
import { License, LicenseType, LicenseStatus, PROGRAM_IDS, Product } from '../types';
import { readSheetData, writeSheetData, clearSheetData } from './googleSheetService';
import { 
  getAppConfig, 
  getCurrentProgram, 
  cleanSheetId, 
  parseKoreanDate, 
  formatDateForSheet, 
  retry,
  callGAS
} from './baseStorageService';

const LICENSE_SCHEMA = { 
  headers: ['License Key', 'PIN', 'Company Name', 'Name / Position', 'Machine ID', 'Expiry Date', 'Status', 'Payment', 'Last Check-in', 'Last Reset', 'Product Name', 'Version', 'Product ID', 'Created At', 'Request ID', 'Contact Info', 'ID', 'Last SMS Sent'],
  keys: ['key', 'pin', 'companyName', 'userName', 'machineId', 'expiresAt', 'status', 'paymentStatus', 'lastCheckIn', 'lastReset', 'productName', 'version', 'productId', 'createdAt', 'requestId', 'contactInfo', 'id', 'lastSmsSent']
};

const PRODUCT_SCHEMA = {
  headers: ['ID', 'Name', 'Version', 'Price', 'Description'],
  keys: ['id', 'name', 'version', 'price', 'description']
};

export const getImpoLicenses = async (force = false): Promise<License[]> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
  if (!p) return [];
  
  const c = getAppConfig();
  const storageKey = `${p.sheetId}_${p.programId}_Licenses`;
  
  if (!force) {
    const local = localStorage.getItem(storageKey);
    if (local) return JSON.parse(local);
  }

  if (c.clientEmail && c.privateKey && p.sheetId) {
    const rows = await retry(() => readSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', c.clientEmail, c.privateKey));
    if (!Array.isArray(rows)) return [];
    
    const dr = rows.length > 0 && (rows[0][0]?.toString().toLowerCase() === 'license key' || rows[0][0]?.toString().toLowerCase() === 'id') ? rows.slice(1) : rows;
    
    const parsed = dr.map((row, rIdx) => {
      const obj: any = {};
      LICENSE_SCHEMA.keys.forEach((key, idx) => {
        let v = row[idx];
        if (v === 'null' || v === undefined) v = null;
        if (['createdAt', 'expiresAt', 'lastSmsSent', 'lastCheckIn', 'lastReset'].includes(key) && v) v = parseKoreanDate(String(v));
        obj[key] = v;
      });
      return {
        ...obj,
        id: obj.id || `lic-${rIdx}-${obj.key || 'nokey'}-${String(obj.createdAt || '').replace(/[^0-9]/g, '').substring(0, 12)}`,
        type: (obj.key === 'TEST' || obj.type === LicenseType.TRIAL) ? LicenseType.TRIAL : (obj.expiresAt ? LicenseType.SUBSCRIPTION : LicenseType.LIFETIME),
        status: (obj.machineId && obj.machineId !== '-' && obj.status === LicenseStatus.PENDING) ? LicenseStatus.ACTIVE : (obj.status || LicenseStatus.PENDING),
        paymentStatus: obj.paymentStatus || 'UNPAID'
      } as License;
    });

    localStorage.setItem(storageKey, JSON.stringify(parsed));
    return parsed;
  }
  return [];
};

export const saveImpoLicense = async (license: License) => {
  const lics = await getImpoLicenses();
  const idx = lics.findIndex(l => l.id === license.id);
  if (idx >= 0) lics[idx] = license; else lics.push(license);
  
  const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
  if (!p) return;

  const c = getAppConfig();
  const rows = [LICENSE_SCHEMA.headers, ...lics.map(l => LICENSE_SCHEMA.keys.map(key => {
    let v = (l as any)[key];
    if (['createdAt', 'expiresAt', 'lastSmsSent', 'lastCheckIn', 'lastReset'].includes(key) && v) return formatDateForSheet(v);
    return (v === null || v === undefined) ? '' : String(v);
  }))];

  await writeSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', rows, c.clientEmail, c.privateKey);
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(lics));
};

export const deleteImpoLicense = async (id: string) => {
    const lics = await getImpoLicenses(true);
    const filtered = lics.filter(l => l.id !== id);
    
    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return;
    const c = getAppConfig();
    const rows = [LICENSE_SCHEMA.headers, ...filtered.map(l => LICENSE_SCHEMA.keys.map(key => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastSmsSent', 'lastCheckIn', 'lastReset'].includes(key) && v) return formatDateForSheet(v);
        return (v === null || v === undefined) ? '' : String(v);
    }))];

    await clearSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', c.clientEmail, c.privateKey);
    await writeSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));
};

export const deleteImpoLicensesBulk = async (ids: string[]) => {
    const lics = await getImpoLicenses(true);
    const filtered = lics.filter(l => !ids.includes(l.id));
    
    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return;
    const c = getAppConfig();
    const rows = [LICENSE_SCHEMA.headers, ...filtered.map(l => LICENSE_SCHEMA.keys.map(key => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastSmsSent', 'lastCheckIn', 'lastReset'].includes(key) && v) return formatDateForSheet(v);
        return (v === null || v === undefined) ? '' : String(v);
    }))];

    await clearSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', c.clientEmail, c.privateKey);
    await writeSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));
};

export const saveImpoLicensesBulk = async (updatedLics: License[]) => {
    const lics = await getImpoLicenses(true);
    let modified = false;
    updatedLics.forEach(updated => {
        const idx = lics.findIndex(l => l.id === updated.id);
        if (idx >= 0) {
            lics[idx] = { ...lics[idx], ...updated };
            modified = true;
        }
    });

    if (!modified) return;

    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return;
    const c = getAppConfig();
    const rows = [LICENSE_SCHEMA.headers, ...lics.map(l => LICENSE_SCHEMA.keys.map(key => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastSmsSent', 'lastCheckIn', 'lastReset'].includes(key) && v) return formatDateForSheet(v);
        return (v === null || v === undefined) ? '' : String(v);
    }))];

    await clearSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', c.clientEmail, c.privateKey);
    await writeSheetData(cleanSheetId(p.sheetId), 'Licenses!A:Z', rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(lics));
};

export const resetImpoMachineId = async (licenseId: string) => {
    const lics = await getImpoLicenses();
    const lic = lics.find(l => l.id === licenseId);
    if (lic) {
        lic.machineId = '';
        lic.lastReset = new Date().toISOString();
        await saveImpoLicense(lic);
    }
};

export const updateImpoMachineId = async (licenseId: string, machineId: string) => {
    const lics = await getImpoLicenses();
    const lic = lics.find(l => l.id === licenseId);
    if (lic) {
        lic.machineId = machineId;
        await saveImpoLicense(lic);
    }
};

export const getImpoProducts = async (force = false): Promise<Product[]> => {
    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return [];
    
    const c = getAppConfig();
    const storageKey = `${p.sheetId}_${p.programId}_Products`;
    
    if (!force) {
      const local = localStorage.getItem(storageKey);
      if (local) return JSON.parse(local);
    }

    if (c.clientEmail && c.privateKey && p.sheetId) {
      const rows = await retry(() => readSheetData(cleanSheetId(p.sheetId), 'Products!A:Z', c.clientEmail, c.privateKey));
      if (!Array.isArray(rows)) return [];
      
      const dr = rows.length > 0 && rows[0][0]?.toString().toLowerCase() === 'id' ? rows.slice(1) : rows;
      
      const parsed = dr.map(row => {
        const obj: any = {};
        PRODUCT_SCHEMA.keys.forEach((key, idx) => {
          let v = row[idx];
          obj[key] = (key === 'price') ? Number(v || 0) : v;
        });
        return obj as Product;
      });

      localStorage.setItem(storageKey, JSON.stringify(parsed));
      return parsed;
    }
    return [];
};

export const saveImpoProduct = async (product: Product) => {
    const prods = await getImpoProducts();
    if (!product.id) product.id = `prod-${Math.random().toString(36).substr(2, 9)}`;
    const idx = prods.findIndex(p => p.id === product.id);
    if (idx >= 0) prods[idx] = product; else prods.push(product);
    
    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return;
    const c = getAppConfig();
    const rows = [PRODUCT_SCHEMA.headers, ...prods.map(prod => PRODUCT_SCHEMA.keys.map(key => String((prod as any)[key] || '')))];
    await writeSheetData(cleanSheetId(p.sheetId), 'Products!A:Z', rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Products`, JSON.stringify(prods));
};

export const deleteImpoProduct = async (id: string) => {
    const prods = await getImpoProducts();
    const filtered = prods.filter(p => p.id !== id);
    
    const p = getCurrentProgram(PROGRAM_IDS.EZIMPO);
    if (!p) return;
    const c = getAppConfig();
    const rows = [PRODUCT_SCHEMA.headers, ...filtered.map(prod => PRODUCT_SCHEMA.keys.map(key => String((prod as any)[key] || '')))];
    await clearSheetData(cleanSheetId(p.sheetId), 'Products!A:Z', c.clientEmail, c.privateKey);
    await writeSheetData(cleanSheetId(p.sheetId), 'Products!A:Z', rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Products`, JSON.stringify(filtered));
};

export const sendImpoSms = async (contact: string, content: string, licenseId?: string) => {
    try {
        const result = await callGAS(PROGRAM_IDS.EZIMPO, 'sendSMS', { contact, content, licenseId });
        if (result && result.success) {
            if (licenseId) {
                const lics = await getImpoLicenses();
                const lic = lics.find(l => l.id === licenseId);
                if (lic) {
                    lic.lastSmsSent = new Date().toISOString();
                    await saveImpoLicense(lic);
                }
            }
            return true;
        }
        return false;
    } catch (err) {
        console.error('SMS 전송 오류:', err);
        return false;
    }
};
