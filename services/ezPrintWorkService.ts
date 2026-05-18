
import { License, LicenseType, LicenseStatus, PROGRAM_IDS } from '../types';
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

const SCHEMA = { 
  headers: ['Admin Email', 'Login ID', 'Password', 'User Name', 'Position', 'Role', 'Company Name', 'Grade/Plan', 'Payment Status', 'Expiry Date', 'Contact Info', 'Last Login', 'Created At'],
  keys: ['adminEmail', 'email', 'password', 'userName', 'position', 'role', 'companyName', 'plan', 'paymentStatus', 'expiresAt', 'contactInfo', 'lastCheckIn', 'createdAt']
};

const TAB_NAME = 'Licenses';

export const getPrintWorkLicenses = async (force = false): Promise<License[]> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return [];
  
  const c = getAppConfig();
  const storageKey = `${p.sheetId}_${p.programId}_Licenses`;
  
  if (!force) {
    const local = localStorage.getItem(storageKey);
    if (local) return JSON.parse(local);
  }

  if (c.clientEmail && c.privateKey && p.sheetId) {
    const rows = await retry(() => readSheetData(cleanSheetId(p.sheetId), `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey));
    if (!Array.isArray(rows)) return [];
    
    // 모든 행을 검사하여 제목줄(Header)이나 비어있는 줄은 제외
    const dr = rows.filter(row => {
      const first = String(row[0] || '').trim().toLowerCase();
      // 제목줄 키워드 필터링
      if (!first || first === 'admin email' || first === 'license key' || first === 'email' || first === 'id') return false;
      // 데이터가 아닌 제목줄의 다른 특징이 있다면 추가
      if (first === 'user email' || first.includes('google 계정')) return false;
      return true;
    });
    
    const parsed = dr.map(row => {
      const obj: any = {};
      SCHEMA.keys.forEach((key, idx) => {
        let v = row[idx];
        if (v === 'null' || v === undefined) v = null;
        if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent', 'paidAt'].includes(key) && v) v = parseKoreanDate(String(v));
        obj[key] = v;
      });
      return {
        ...obj,
        id: obj.email || `pw-${Math.random().toString(36).substr(2, 9)}`,
        programId: PROGRAM_IDS.EZPRINTWORK,
        paymentStatus: obj.paymentStatus || 'UNPAID'
      } as License;
    });

    localStorage.setItem(storageKey, JSON.stringify(parsed));
    return parsed;
  }
  return [];
};

export const savePrintWorkLicense = async (license: License) => {
  const lics = await getPrintWorkLicenses();
  const idx = lics.findIndex(l => l.id === license.id || (l.email === license.email && l.email !== ''));
  if (idx >= 0) lics[idx] = license; else lics.push(license);
  
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return;

  const c = getAppConfig();
  const rows = [SCHEMA.headers, ...lics.map(l => SCHEMA.keys.map(key => {
    let v = (l as any)[key];
    if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent', 'paidAt'].includes(key) && v) return formatDateForSheet(v);
    return (v === null || v === undefined) ? '' : String(v);
  }))];

  await writeSheetData(cleanSheetId(p.sheetId), `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(lics));
};

export const deletePrintWorkLicense = async (id: string) => {
    const lics = await getPrintWorkLicenses();
    const filtered = lics.filter(l => l.id !== id);
    
    const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
    if (!p) return;
    const c = getAppConfig();
    const rows = [SCHEMA.headers, ...filtered.map(l => SCHEMA.keys.map(key => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent'].includes(key) && v) return formatDateForSheet(v);
        return (v === null || v === undefined) ? '' : String(v);
    }))];

    await writeSheetData(cleanSheetId(p.sheetId), `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);
    localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));
};

export const updatePrintWorkPlan = async (email: string, plan: string) => {
    const lics = await getPrintWorkLicenses();
    const lic = lics.find(l => l.email === email);
    if (lic) {
        lic.plan = plan;
        lic.status = LicenseStatus.ACTIVE;
        await savePrintWorkLicense(lic);
    }
};

export const sendPrintWorkSms = async (contact: string, content: string, licenseId?: string) => {
    try {
        const result = await callGAS(PROGRAM_IDS.EZPRINTWORK, 'sendSMS', { contact, content, licenseId });
        if (result && result.success) {
            if (licenseId) {
                const lics = await getPrintWorkLicenses();
                const lic = lics.find(l => l.id === licenseId);
                if (lic) {
                    lic.lastSmsSent = new Date().toISOString();
                    await savePrintWorkLicense(lic);
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

export const syncPrintWorkStructure = async () => {
    const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
    if (!p) return;
    const c = getAppConfig();
    
    // 1. 시트 데이터 원본 읽기
    const rows = await retry(() => readSheetData(cleanSheetId(p.sheetId), `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey));
    if (!Array.isArray(rows) || rows.length === 0) {
        alert('시트에 데이터가 없거나 읽어올 수 없습니다.');
        return;
    }

    // 2. 헤더 확인 및 마이그레이션
    const firstRow = rows[0].map(h => String(h).trim());
    const isOldStructure = firstRow.includes('License Key') || firstRow.includes('PIN') || firstRow.includes('Name / Position');
    const isMiddleStructure = firstRow.includes('User Email') && !firstRow.includes('Password');

    let migratedData: License[] = [];
    if (isOldStructure) {
        console.log('Performing DEEP CLEAN migration from PIN-based legacy structure...');
        const dataRows = rows.slice(1).filter(row => {
            const first = String(row[0] || '').trim();
            if (!first || first === 'Admin Email' || first === 'User Email') return false;
            return true;
        });

        migratedData = dataRows.map(row => {
            const email = String(row[0] || '').trim();
            return {
                adminEmail: email,
                email: email,
                key: email,
                password: '',
                userName: String(row[2] || ''),
                position: String(row[3] || '').includes('ADMIN') ? '대표자' : '',
                role: String(row[3] || '').includes('ADMIN') ? 'ADMIN' : 'MEMBER',
                companyName: String(row[4] || row[5] || '미지정 회사'),
                plan: String(row[6] || 'ad'),
                paymentStatus: String(row[7] || '').includes('UNPAID') ? 'UNPAID' : 'PAID',
                expiresAt: parseKoreanDate(String(row[8] || row[5] || '')),
                contactInfo: String(row[9] || ''),
                lastCheckIn: parseKoreanDate(String(row[11] || '')),
                createdAt: parseKoreanDate(String(row[12] || '')),
                id: email,
                programId: PROGRAM_IDS.EZPRINTWORK,
                productId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION,
                status: LicenseStatus.ACTIVE
            } as License;
        });
    } else if (isMiddleStructure) {
        console.log('Migrating from 13-column User Email structure to new Password/Login ID structure...');
        const dataRows = rows.slice(1).filter(row => {
            const first = String(row[0] || '').trim();
            if (!first || first === 'Admin Email' || first === 'User Email') return false;
            return true;
        });

        migratedData = dataRows.map((row, idx) => {
            const adminEmailVal = String(row[0] || '').trim();
            let emailVal = String(row[1] || '').trim();
            const userNameVal = String(row[2] || '사용자');
            const posVal = String(row[3] || '');
            let roleVal = String(row[4] || '').toUpperCase();
            
            // 보완 로직: Role이 비어있는 경우 Position에 MEMBER가 적혀있거나 하면 자동 수정
            if (!roleVal) {
                if (posVal.toUpperCase().includes('ADMIN') || idx === 0) roleVal = 'ADMIN';
                else roleVal = 'MEMBER';
            }

            // 보완 로직: 직원의 Login ID가 빈 칸인 경우 임시 ID 자동 매핑
            if (!emailVal) {
                if (roleVal === 'ADMIN') {
                    emailVal = adminEmailVal;
                } else {
                    const prefix = adminEmailVal.includes('@') ? adminEmailVal.split('@')[0] : 'user';
                    emailVal = `${prefix}-${userNameVal.replace(/\s+/g, '')}`;
                }
            }

            return {
                adminEmail: adminEmailVal,
                email: emailVal,
                key: emailVal,
                password: 'temp' + Math.floor(1000 + Math.random() * 9000), // 초기 임시 패스워드 자동 생성
                userName: userNameVal,
                position: posVal,
                role: roleVal,
                companyName: String(row[5] || '미지정 회사'),
                plan: String(row[6] || 'ad'),
                paymentStatus: String(row[7] || 'UNPAID'),
                expiresAt: parseKoreanDate(String(row[8] || '')),
                contactInfo: String(row[9] || ''),
                lastCheckIn: parseKoreanDate(String(row[11] || '')),
                createdAt: parseKoreanDate(String(row[12] || '')),
                id: emailVal,
                programId: PROGRAM_IDS.EZPRINTWORK,
                productId: PROGRAM_IDS.EZPRINTWORK,
                type: LicenseType.SUBSCRIPTION,
                status: LicenseStatus.ACTIVE
            } as License;
        });
    } else {
        migratedData = await getPrintWorkLicenses(true);
    }

    // 3. 새로운 SCHEMA 순서로 시트 데이터 생성
    const newRows = [SCHEMA.headers, ...migratedData.map(l => SCHEMA.keys.map(key => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastCheckIn', 'paidAt'].includes(key) && v) return formatDateForSheet(v);
        return (v === null || v === undefined) ? '' : String(v);
    }))];

    // 4. 시트 전체 초기화 후 다시 쓰기 (확실하게 비우기 위해 A:Z 사용)
    console.log('Clearing and Syncing EzPrintWork Sheet...');
    const sheetId = cleanSheetId(p.sheetId);
    await clearSheetData(sheetId, `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey);
    await writeSheetData(sheetId, `'${TAB_NAME}'!A:Z`, newRows, c.clientEmail, c.privateKey);
    
    localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(migratedData));
};
