
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
import { sendSmsViaSolapi } from './smsService';
import { 
  getAllTenants, 
  getAllWebUsers, 
  saveWebLicenseToFirestore, 
  deleteWebLicenseFromFirestore,
  deleteWebTenantDirect,
  deleteWebUserDirect,
  findWebUserByEmail,
  webDb
} from './firebaseBridge';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { 
  uploadBackupToGoogleDrive, 
  listBackupsFromGoogleDrive, 
  downloadBackupFromGoogleDrive, 
  deleteBackupFromGoogleDrive, 
  pruneOldBackupsInGoogleDrive 
} from './googleSheetService';

const SCHEMA = { 
  headers: ['Admin Email', 'Login ID', 'Password', 'User Name', 'Position', 'Role', 'Company Name', 'Business Number', 'Company Entry Code', 'Grade/Plan', 'Payment Status', 'Expiry Date', 'Contact Info', 'Last Login', 'Created At'],
  keys: ['adminEmail', 'email', 'password', 'userName', 'position', 'role', 'companyName', 'businessNumber', 'joinCode', 'plan', 'paymentStatus', 'expiresAt', 'contactInfo', 'lastCheckIn', 'createdAt']
};

const TAB_NAME = 'licenses';

export const getPrintWorkLicenses = async (force = false): Promise<License[]> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return [];
  
  const c = getAppConfig();
  const storageKey = `${p.sheetId}_${p.programId}_Licenses`;
  
  if (!force) {
    const local = localStorage.getItem(storageKey);
    if (local) {
      try {
        return JSON.parse(local);
      } catch (e) {
        console.warn("Failed to parse local storage cache, refetching...", e);
      }
    }
  }

  // 1. Fetch from Firestore (SSOT Master)
  let firestoreLicenses: License[] = [];
  try {
    const [tenants, users] = await Promise.all([
      getAllTenants(),
      getAllWebUsers()
    ]);

    // 각 테넌트 하위의 사내 직원(staff) 서브컬렉션 병렬 일괄 로드 추가 (실시간 FUSE 연동)
    const staffPromises = tenants.map(async (t) => {
      try {
        const staffRef = collection(webDb, `tenants/${t.id}/staff`);
        const snap = await getDocs(staffRef);
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.warn(`[ezPrintWorkService] Failed to load staff subcollection for tenant ${t.id}:`, err);
        return [];
      }
    });
    const staffArrays = await Promise.all(staffPromises);
    
    // 직원 email, uid, id 기반 staffMap 구축
    const staffMap = new Map<string, any>();
    staffArrays.forEach(arr => {
      arr.forEach((s: any) => {
        if (s.email) staffMap.set(s.email.trim().toLowerCase(), s);
        if (s.id) staffMap.set(s.id, s);
        if (s.uid) staffMap.set(s.uid, s);
      });
    });

    // Map Firestore data to License schema
    const tenantMap = new Map(tenants.map(t => [t.id, t]));
    
    firestoreLicenses = users.map(u => {
      const tenant = u.tenantId ? tenantMap.get(u.tenantId) : null;
      const isOwner = u.role === 'admin';
      
      const planVal = tenant ? tenant.plan : 'free';
      const companyNameVal = tenant ? tenant.name : '미지정 회사';
      const joinCodeVal = tenant ? (tenant as any).joinCode || '' : '';
      const businessNumberVal = tenant ? (tenant as any).businessNumber || '' : '';
      const expiresAtVal = tenant ? tenant.licenseExpiresAt || null : null;
      const paymentStatusVal = tenant ? (tenant as any).paymentStatus || 'UNPAID' : 'UNPAID';

      // 1:1 매칭되는 staff 문서 탐색
      const emailLower = u.email ? u.email.trim().toLowerCase() : '';
      const staffDoc = staffMap.get(emailLower) || staffMap.get(u.uid) || staffMap.get(u.id) || null;

      // Find the admin user's email for staff members
      let adminEmailVal = isOwner ? u.email : '';
      if (!isOwner && u.tenantId) {
        const ownerId = tenant?.ownerId;
        if (ownerId) {
          const ownerUser = users.find(usr => usr.uid === ownerId);
          if (ownerUser) adminEmailVal = ownerUser.email;
        }
      }

      // [1] 연락처 복합 탐색 (Fallback 체인: 회사 휴대폰 -> 개인 휴대폰 -> 글로벌 정보 순)
      const contactInfoVal = (
        staffDoc?.phoneCompany || 
        staffDoc?.phone || 
        u.contactInfo || 
        (u as any).phone || 
        (u as any).contact || 
        staffDoc?.contactInfo || 
        staffDoc?.contact || 
        ''
      ).trim();

      // [2] 직급/직책 복합 탐색 (Fallback 체인)
      const positionVal = (
        staffDoc?.role || 
        staffDoc?.position || 
        u.position || 
        (u as any).role || 
        (isOwner ? '대표자' : '')
      ).trim() || '직원';

      // [3] 비밀번호 실시간 연동 (Fallback 체인)
      const passwordVal = (
        staffDoc?.password || 
        (u as any).password || 
        ''
      ).trim();

      // [4] 최근 접속 일시 다각도 탐색 (Fallback 체인)
      const times = [
        staffDoc?.lastLogin,
        staffDoc?.lastActive,
        staffDoc?.lastCheckIn,
        staffDoc?.updatedAt,
        (u as any).lastLogin,
        (u as any).lastActive,
        (u as any).lastCheckIn,
        (u as any).updatedAt
      ];
      let latestTime: Date | null = null;
      for (const t of times) {
        if (t) {
          const d = new Date(t);
          if (!isNaN(d.getTime())) {
            if (!latestTime || d > latestTime) {
              latestTime = d;
            }
          }
        }
      }
      const lastCheckInVal = latestTime ? latestTime.toISOString() : null;

      // [5] 실시간 온라인 상태
      const isOnlineVal = 
        staffDoc?.online === true || 
        staffDoc?.isOnline === true || 
        (u as any).online === true || 
        (u as any).isOnline === true;

      return {
        id: u.email || `pw-${u.uid}`,
        adminEmail: adminEmailVal || u.email,
        email: u.email,
        password: passwordVal,
        userName: u.displayName || u.userName || '웹 사용자',
        position: positionVal,
        role: isOwner ? 'ADMIN' : 'MEMBER',
        companyName: companyNameVal,
        businessNumber: businessNumberVal,
        joinCode: joinCodeVal,
        plan: planVal === 'pro_plus' ? 'service' : (planVal === 'free' ? 'ad' : planVal),
        paymentStatus: paymentStatusVal as any,
        expiresAt: expiresAtVal,
        contactInfo: contactInfoVal,
        lastCheckIn: lastCheckInVal,
        isOnline: isOnlineVal,
        createdAt: u.createdAt || tenant?.createdAt || new Date().toISOString(),
        programId: PROGRAM_IDS.EZPRINTWORK,
        status: LicenseStatus.ACTIVE,
        key: u.email,
        productId: PROGRAM_IDS.EZPRINTWORK,
        type: LicenseType.SUBSCRIPTION
      } as License;
    });
  } catch (err) {
    console.error("[ezPrintWorkService] Failed to load data from Firestore:", err);
  }

  // 2. Fetch from Google Sheets (Backup mirror / Ledger) with fallback
  let sheetLicenses: License[] = [];
  if (c.clientEmail && c.privateKey && p.sheetId) {
    try {
      const rows = await retry(() => readSheetData(cleanSheetId(p.sheetId), `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey));
      if (Array.isArray(rows)) {
        const dr = rows.filter(row => {
          const first = String(row[0] || '').trim().toLowerCase();
          if (!first || first === 'admin email' || first === 'license key' || first === 'email' || first === 'id') return false;
          if (first === 'user email' || first.includes('google 계정')) return false;
          return true;
        });

        sheetLicenses = dr.map(row => {
          const obj: any = {};
          SCHEMA.keys.forEach((key, idx) => {
            let v = row[idx];
            if (v === 'null' || v === undefined) v = null;
            if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent', 'paidAt'].includes(key) && v) v = parseKoreanDate(String(v));
            obj[key] = v;
          });

          let emailVal = (obj.email || '').trim();
          if (emailVal && !emailVal.includes('@')) {
            emailVal = `${emailVal}@ez-hub.kr`;
          }

          return {
            ...obj,
            email: emailVal,
            id: emailVal || `pw-${Math.random().toString(36).substr(2, 9)}`,
            programId: PROGRAM_IDS.EZPRINTWORK,
            paymentStatus: obj.paymentStatus || 'UNPAID'
          } as License;
        });
      }
    } catch (sheetErr) {
      console.warn("[ezPrintWorkService] Google Sheets read failed (using backup mirror logic):", sheetErr);
    }
  }

  // 3. FUSE data: Use Firestore as master.
  // Overwrite Google Sheet data with Firestore records matching by email,
  // and keep sheet-only rows (e.g. legacy sheet-only clients).
  const fusedMap = new Map<string, License>();
  
  // First load sheet rows
  sheetLicenses.forEach(lic => {
    if (lic.email) fusedMap.set(lic.email.toLowerCase(), lic);
  });
  
  // Then overwrite with live Firestore records
  firestoreLicenses.forEach(lic => {
    if (lic.email) {
      const emailLower = lic.email.toLowerCase();
      const existsInSheet = fusedMap.has(emailLower);
      fusedMap.set(emailLower, {
        ...lic,
        isWebOnly: !existsInSheet
      } as any);
    }
  });

  const parsed = Array.from(fusedMap.values());

  // Save fused state to local storage cache for instant rendering next time
  localStorage.setItem(storageKey, JSON.stringify(parsed));
  return parsed;
};

export const savePrintWorkLicense = async (license: License) => {
  let emailVal = (license.email || '').trim();
  if (emailVal && !emailVal.includes('@')) {
    emailVal = `${emailVal}@ez-hub.kr`;
  }
  
  const normalizedLicense = { 
    ...license, 
    email: emailVal,
    id: emailVal,
    key: emailVal
  };

  const lics = await getPrintWorkLicenses();
  
  const isDuplicate = lics.some(l => 
    l.id !== normalizedLicense.id && 
    l.email.toLowerCase() === normalizedLicense.email.toLowerCase() && 
    l.email !== ''
  );
  
  if (isDuplicate) {
    const dupCompany = lics.find(l => 
      l.id !== normalizedLicense.id && 
      l.email.toLowerCase() === normalizedLicense.email.toLowerCase()
    )?.companyName || '다른 회사';
    throw new Error(`이미 [${dupCompany}]에서 사용 중인 로그인 ID입니다.`);
  }

  const idx = lics.findIndex(l => l.id === normalizedLicense.id);
  const oldEmail = idx >= 0 ? lics[idx].email : undefined;
  
  if (normalizedLicense.role === 'ADMIN' && idx >= 0) {
    const newEmail = normalizedLicense.email;
    if (oldEmail && newEmail && oldEmail !== newEmail) {
      lics.forEach(l => {
        if (l.adminEmail === oldEmail) {
          l.adminEmail = newEmail;
        }
      });
    }
  }

  const updatedLicense = { ...normalizedLicense };

  if (idx >= 0) {
    lics[idx] = updatedLicense;
  } else {
    lics.push(updatedLicense);
  }

  // 1. Direct Blocking Firestore Master Write
  await saveWebLicenseToFirestore(updatedLicense, oldEmail);

  // 2. Instantly Update Local Storage Cache
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return;
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(lics));

  // 3. Detached, Non-Blocking Google Sheets Mirror Write
  const c = getAppConfig();
  if (c.clientEmail && c.privateKey && p.sheetId) {
    const rows = [SCHEMA.headers, ...lics.map(l => SCHEMA.keys.map(key => {
      let v = (l as any)[key];
      if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent', 'paidAt'].includes(key) && v) return formatDateForSheet(v);
      return (v === null || v === undefined) ? '' : String(v);
    }))];
    
    const sheetId = cleanSheetId(p.sheetId);
    
    // Spawn background sync
    Promise.resolve().then(async () => {
      try {
        console.log(`[ezPrintWorkService] Starting background Sheet mirror sync...`);
        await clearSheetData(sheetId, `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey);
        await writeSheetData(sheetId, `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);
        console.log(`[ezPrintWorkService] Background Sheet mirror sync successful!`);
      } catch (err) {
        console.warn(`[ezPrintWorkService] Background Sheet mirror sync failed:`, err);
      }
    });
  }
};

export const deletePrintWorkLicense = async (id: string) => {
  const lics = await getPrintWorkLicenses();
  const target = lics.find(l => l.id === id);
  if (!target) return;

  const filtered = lics.filter(l => l.id !== id);
  
  // 1. Direct Blocking Firestore Master Delete (100% ID-based safe deletion)
  try {
    if (target.email) {
      const match = await findWebUserByEmail(target.email);
      if (match) {
        const { user, tenantId } = match;
        const emailLower = target.email.trim().toLowerCase();
        
        // [Safe Isolation] 진짜 활성 춘천인쇄 테넌트 보호 장치 (대표자 이메일만 정밀 보호)
        const isRealActiveTenant = (emailLower === 'ccp5770@gmail.com' || emailLower === 'ccpt78@gmail.com');
        
        if (target.role === 'ADMIN' && tenantId) {
          if (isRealActiveTenant) {
            console.warn(`[SafeDelete] Prevented accidental deletion of real active B2B Tenant: ${target.email}`);
          } else {
            await deleteWebTenantDirect(tenantId);
            console.log(`[SafeDelete] Successfully deleted B2B Tenant directly: ${tenantId}`);
          }
        } else if (user.uid) {
          await deleteWebUserDirect(user.uid, tenantId);
          console.log(`[SafeDelete] Successfully deleted B2B User safely by ID: ${user.uid}`);
        }
      }
    }
  } catch (err) {
    console.error(`[ezPrintWorkService] Failed to safely delete Firestore web license for ${target.email}:`, err);
  }

  // 2. Instantly Update Local Storage Cache
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return;
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));

  // 3. Detached, Non-Blocking Google Sheets Mirror Delete
  const c = getAppConfig();
  if (c.clientEmail && c.privateKey && p.sheetId) {
    const rows = [SCHEMA.headers, ...filtered.map(l => SCHEMA.keys.map(key => {
      let v = (l as any)[key];
      if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent'].includes(key) && v) return formatDateForSheet(v);
      return (v === null || v === undefined) ? '' : String(v);
    }))];

    const sheetId = cleanSheetId(p.sheetId);

    Promise.resolve().then(async () => {
      try {
        console.log(`[ezPrintWorkService] Starting background Sheet mirror delete...`);
        await clearSheetData(sheetId, `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey);
        await writeSheetData(sheetId, `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);
        console.log(`[ezPrintWorkService] Background Sheet mirror delete successful!`);
      } catch (err) {
        console.warn(`[ezPrintWorkService] Background Sheet mirror delete failed:`, err);
      }
    });
  }
};

export const deletePrintWorkLicensesBulk = async (ids: string[]) => {
  const lics = await getPrintWorkLicenses();
  const targets = lics.filter(l => ids.includes(l.id));
  const filtered = lics.filter(l => !ids.includes(l.id));

  // 1. Direct Blocking Firestore Master Deletes (100% ID-based safe deletion)
  for (const target of targets) {
    try {
      if (target.email) {
        const match = await findWebUserByEmail(target.email);
        if (match) {
          const { user, tenantId } = match;
          const emailLower = target.email.trim().toLowerCase();
          
          // [Safe Isolation] 진짜 활성 춘천인쇄 테넌트 보호 장치 (대표자 이메일만 정밀 보호)
          const isRealActiveTenant = (emailLower === 'ccp5770@gmail.com' || emailLower === 'ccpt78@gmail.com');

          if (target.role === 'ADMIN' && tenantId) {
            if (isRealActiveTenant) {
              console.warn(`[SafeDelete-Bulk] Prevented accidental deletion of real active B2B Tenant: ${target.email}`);
            } else {
              await deleteWebTenantDirect(tenantId);
              console.log(`[SafeDelete-Bulk] Successfully deleted B2B Tenant directly: ${tenantId}`);
            }
          } else if (user.uid) {
            await deleteWebUserDirect(user.uid, tenantId);
            console.log(`[SafeDelete-Bulk] Successfully deleted B2B User safely by ID: ${user.uid}`);
          }
        }
      }
    } catch (err) {
      console.error(`[ezPrintWorkService] Failed to safely delete Firestore web license for ${target.email} during bulk delete:`, err);
    }
  }

  // 2. Instantly Update Local Storage Cache
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return;
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));

  // 3. Detached, Non-Blocking Google Sheets Mirror Bulk Delete
  const c = getAppConfig();
  if (c.clientEmail && c.privateKey && p.sheetId) {
    const rows = [SCHEMA.headers, ...filtered.map(l => SCHEMA.keys.map(key => {
      let v = (l as any)[key];
      if (['createdAt', 'expiresAt', 'lastCheckIn', 'lastSmsSent'].includes(key) && v) return formatDateForSheet(v);
      return (v === null || v === undefined) ? '' : String(v);
    }))];

    const sheetId = cleanSheetId(p.sheetId);

    Promise.resolve().then(async () => {
      try {
        console.log(`[ezPrintWorkService] Starting background Sheet mirror bulk delete...`);
        await clearSheetData(sheetId, `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey);
        await writeSheetData(sheetId, `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);
        console.log(`[ezPrintWorkService] Background Sheet mirror bulk delete successful!`);
      } catch (err) {
        console.warn(`[ezPrintWorkService] Background Sheet mirror bulk delete failed:`, err);
      }
    });
  }
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
        const result = await sendSmsViaSolapi(contact, content);
        if (result.success) {
            if (licenseId) {
                const lics = await getPrintWorkLicenses();
                const lic = lics.find(l => l.id === licenseId);
                if (lic) {
                    lic.lastSmsSent = new Date().toISOString();
                    await savePrintWorkLicense(lic);
                }
            }
            return true;
        } else {
            alert(result.message);
            return false;
        }
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

/**
 * Generates a full text-based JSON snapshot of the entire EzPrintWork B2B Database in Firestore.
 */
export const generateFullDatabaseBackup = async (): Promise<string> => {
  console.log("[BackupManager] Starting full Firestore database scan...");
  
  // 1. Fetch all tenants and global users
  const [tenants, users] = await Promise.all([
    getAllTenants(),
    getAllWebUsers()
  ]);

  const tenantSubcollections: Record<string, {
    jobs: any[];
    customers: any[];
    settings: any[];
    staff: any[];
  }> = {};

  // 2. Fetch all subcollections for each tenant
  for (const tenant of tenants) {
    try {
      const jobsRef = collection(webDb, `tenants/${tenant.id}/jobs`);
      const customersRef = collection(webDb, `tenants/${tenant.id}/customers`);
      const settingsRef = collection(webDb, `tenants/${tenant.id}/settings`);
      const staffRef = collection(webDb, `tenants/${tenant.id}/staff`);

      const [jobsSnap, customersSnap, settingsSnap, staffSnap] = await Promise.all([
        getDocs(jobsRef),
        getDocs(customersRef),
        getDocs(settingsRef),
        getDocs(staffRef)
      ]);

      tenantSubcollections[tenant.id] = {
        jobs: jobsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        customers: customersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        settings: settingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        staff: staffSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      };
      console.log(`[BackupManager] Successfully scanned tenant subcollections for: ${tenant.name} (${tenant.id})`);
    } catch (err) {
      console.warn(`[BackupManager] Failed to scan subcollections for tenant ${tenant.id}:`, err);
      tenantSubcollections[tenant.id] = { jobs: [], customers: [], settings: [], staff: [] };
    }
  }

  const payload = {
    version: "1.1.0",
    appName: "EzPrintWork",
    backupTime: new Date().toISOString(),
    tenants,
    users,
    tenantSubcollections
  };

  return JSON.stringify(payload, null, 2);
};

/**
 * Fully restores the Firestore database from a backup JSON payload.
 * Extremely high-integrity restoration for disaster recovery.
 */
export const restoreFullDatabaseFromBackup = async (backupJson: string): Promise<boolean> => {
  try {
    const data = JSON.parse(backupJson);
    if (!data.tenants || !data.users || !data.tenantSubcollections) {
      throw new Error("올바른 EzPrintWork 백업 파일 형식이 아닙니다.");
    }

    console.log(`[DisasterRecovery] Starting complete restore of ${data.tenants.length} tenants and ${data.users.length} users...`);

    // 1. Restore global tenants
    for (const tenant of data.tenants) {
      const tenantRef = doc(webDb, 'tenants', tenant.id);
      await setDoc(tenantRef, tenant, { merge: true });
      console.log(`[DisasterRecovery] Restored tenant: ${tenant.name} (${tenant.id})`);
    }

    // 2. Restore global users
    for (const user of data.users) {
      const userRef = doc(webDb, 'users', user.uid || user.id);
      await setDoc(userRef, user, { merge: true });
      console.log(`[DisasterRecovery] Restored user: ${user.email} (${user.uid || user.id})`);
    }

    // 3. Restore B2B subcollections per tenant
    const subkeys = Object.keys(data.tenantSubcollections);
    for (const tenantId of subkeys) {
      const sub = data.tenantSubcollections[tenantId];
      
      // Restore jobs
      if (Array.isArray(sub.jobs)) {
        for (const job of sub.jobs) {
          const jobRef = doc(webDb, `tenants/${tenantId}/jobs`, job.id);
          await setDoc(jobRef, job, { merge: true });
        }
      }

      // Restore customers
      if (Array.isArray(sub.customers)) {
        for (const cust of sub.customers) {
          const custRef = doc(webDb, `tenants/${tenantId}/customers`, cust.id);
          await setDoc(custRef, cust, { merge: true });
        }
      }

      // Restore settings
      if (Array.isArray(sub.settings)) {
        for (const setItem of sub.settings) {
          const setRef = doc(webDb, `tenants/${tenantId}/settings`, setItem.id);
          await setDoc(setRef, setItem, { merge: true });
        }
      }

      // Restore staff
      if (Array.isArray(sub.staff)) {
        for (const member of sub.staff) {
          const staffRef = doc(webDb, `tenants/${tenantId}/staff`, member.id);
          await setDoc(staffRef, member, { merge: true });
        }
      }
      console.log(`[DisasterRecovery] Restored B2B subcollections for tenant ID: ${tenantId}`);
    }

    console.log("[DisasterRecovery] Firestore database restore completed successfully!");
    return true;
  } catch (err: any) {
    console.error("[DisasterRecovery] Restore operation failed:", err);
    throw new Error(`데이터베이스 복구 실패: ${err.message}`);
  }
};

/**
 * Automatically runs the daily background backup and prunes old backups in Google Drive.
 * This is 100% free (Google Drive Service Account up to 15GB free).
 */
export const runDailyAutoBackup = async (): Promise<boolean> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return false;
  const c = getAppConfig();
  if (!c.clientEmail || !c.privateKey) {
    console.warn("[AutoBackup] Skipping daily backup because Google Service Account credentials are not configured.");
    return false;
  }

  try {
    const backupJson = await generateFullDatabaseBackup();
    const dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0]; // e.g. "2026-05-21T22-15-00"
    const fileName = `EzPrintWork_Backup_${dateStr}.json`;

    console.log(`[AutoBackup] Uploading backup file ${fileName} to Google Drive...`);
    const fileId = await uploadBackupToGoogleDrive(fileName, backupJson, c.clientEmail, c.privateKey);
    console.log(`[AutoBackup] Cloud backup successful! Google Drive File ID: ${fileId}`);

    // Prune old backups to protect the 15GB free limit (keeping last 30 daily backups)
    await pruneOldBackupsInGoogleDrive(c.clientEmail, c.privateKey, 30);
    return true;
  } catch (err) {
    console.error("[AutoBackup] Cloud backup failed:", err);
    throw err;
  }
};

/**
 * Fetches the list of Google Drive backups for the UI
 */
export const fetchGoogleDriveBackups = async () => {
  const c = getAppConfig();
  if (!c.clientEmail || !c.privateKey) return [];
  return await listBackupsFromGoogleDrive(c.clientEmail, c.privateKey);
};

/**
 * Downloads a backup from Google Drive by file ID
 */
export const fetchBackupContentFromDrive = async (fileId: string): Promise<string> => {
  const c = getAppConfig();
  if (!c.clientEmail || !c.privateKey) throw new Error("Credentials missing");
  return await downloadBackupFromGoogleDrive(fileId, c.clientEmail, c.privateKey);
};

/**
 * Deletes a backup from Google Drive by file ID
 */
export const removeBackupFromDrive = async (fileId: string): Promise<boolean> => {
  const c = getAppConfig();
  if (!c.clientEmail || !c.privateKey) return false;
  return await deleteBackupFromGoogleDrive(fileId, c.clientEmail, c.privateKey);
};
