
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
  fetchTenantsAndUsersForManager,
  saveWebLicenseToFirestore, 
  deleteWebLicenseFromFirestore,
  deleteWebTenantDirect,
  deleteWebUserDirect,
  findWebUserByEmail,
  fetchTenantSettingsMeta,
  resolveBusinessNumber,
  webDb,
  type FirestoreLoadFailureReason,
} from './firebaseBridge';
import {
  resolveAdminContactInfo,
  resolveStaffContactInfo,
  resolveTenantAppVersion,
  resolveTenantOwnerUser,
  isTenantRepresentativeAdminUser,
} from '../utils/ezPrintWorkResolve';

const PRESENCE_STALE_MS = 5 * 60 * 1000;

const isRecentlyActive = (record: Record<string, unknown> | null | undefined): boolean => {
  if (!record) return false;
  const last = String(
    record.lastActive || record.activeSessionAt || record.lastLogin || record.lastCheckIn || ''
  ).trim();
  if (!last) return false;
  const ts = new Date(last).getTime();
  return Number.isFinite(ts) && Date.now() - ts < PRESENCE_STALE_MS;
};

const resolveIsOnline = (...records: Array<Record<string, unknown> | null | undefined>): boolean => {
  for (const record of records) {
    if (!record) continue;
    const flaggedOnline = record.online === true || record.isOnline === true;
    if (flaggedOnline && isRecentlyActive(record)) return true;
  }
  return false;
};
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { 
  uploadBackupToGoogleDrive, 
  listBackupsFromGoogleDrive, 
  downloadBackupFromGoogleDrive, 
  deleteBackupFromGoogleDrive, 
  pruneOldBackupsInGoogleDrive 
} from './googleSheetService';
import { auth } from '../firebase';
import { ensureAuth } from './authService';

const SCHEMA = { 
  headers: ['Admin Email', 'Login ID', 'Password', 'User Name', 'Position', 'Role', 'Company Name', 'Business Number', 'Company Entry Code', 'Grade/Plan', 'Payment Status', 'Expiry Date', 'Contact Info', 'Last Login', 'Created At'],
  keys: ['adminEmail', 'email', 'password', 'userName', 'position', 'role', 'companyName', 'businessNumber', 'joinCode', 'plan', 'paymentStatus', 'expiresAt', 'contactInfo', 'lastCheckIn', 'createdAt']
};

const TAB_NAME = 'licenses';

export type LicenseSyncMeta = {
  source: 'firestore' | 'sheet' | 'cache' | 'empty';
  firestoreCount: number;
  /** MEMBER(사내 직원) 라이선스 수 — staff 서브컬렉션에서 매핑된 건수 */
  memberCount: number;
  /** staff getDocs 실패 테넌트 (표시용) */
  staffLoadFailures: { tenantId: string; name?: string; message: string }[];
  authenticated: boolean;
  syncedAt: string;
  /** Firestore 조회 실패 시 원인 (UI 배너용) */
  failureReason?: FirestoreLoadFailureReason | null;
  errorMessage?: string;
};

let lastLicenseSyncMeta: LicenseSyncMeta = {
  source: 'empty',
  firestoreCount: 0,
  memberCount: 0,
  staffLoadFailures: [],
  authenticated: false,
  syncedAt: '',
  failureReason: null,
  errorMessage: '',
};

/** Firestore 성공 목록 → 시트 자동 미러 최소 간격 */
const AUTO_SHEET_MIRROR_THROTTLE_MS = 15 * 60 * 1000;
const AUTO_SHEET_MIRROR_AT_KEY = 'lfm_pw_auto_sheet_mirror_at_v1';

const isGoodFirestoreLicenseSnapshot = (licenses: License[]): boolean => {
  const admins = licenses.filter(
    (l) => l.role === 'ADMIN' && String(l.companyName || '') !== '미지정 회사'
  );
  return admins.length > 0;
};

/**
 * Firestore에서 성공적으로 읽은 목록만 구글 시트 licenses에 덮어씁니다.
 * 깨진/부분 데이터로는 호출하지 마세요.
 */
export const mirrorFirestoreLicensesToSheet = async (
  licenses: License[],
  opts?: { silent?: boolean }
): Promise<{ ok: boolean; count: number; message: string }> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p?.sheetId) {
    return { ok: false, count: 0, message: '시트 ID가 없습니다.' };
  }
  if (!isGoodFirestoreLicenseSnapshot(licenses)) {
    return { ok: false, count: 0, message: '불완전한 목록은 시트에 반영하지 않습니다.' };
  }

  const c = getAppConfig();
  if (!c.clientEmail || !c.privateKey) {
    return { ok: false, count: 0, message: 'Google 서비스 계정 설정이 없습니다.' };
  }

  const rows = [
    SCHEMA.headers,
    ...licenses.map((l) =>
      SCHEMA.keys.map((key) => {
        let v = (l as any)[key];
        if (['createdAt', 'expiresAt', 'lastCheckIn', 'paidAt'].includes(key) && v) {
          return formatDateForSheet(v);
        }
        return v === null || v === undefined ? '' : String(v);
      })
    ),
  ];

  const sheetId = cleanSheetId(p.sheetId);
  await clearSheetData(sheetId, `'${TAB_NAME}'!A:Z`, c.clientEmail, c.privateKey);
  await writeSheetData(sheetId, `'${TAB_NAME}'!A:Z`, rows, c.clientEmail, c.privateKey);

  const adminCount = licenses.filter((l) => l.role === 'ADMIN').length;
  const msg = `시트 미러 완료 · ADMIN ${adminCount}건 / 전체 ${licenses.length}건`;
  console.log('[SheetMirror]', msg);
  if (!opts?.silent) {
    /* quiet by default for auto path */
  }
  return { ok: true, count: licenses.length, message: msg };
};

/**
 * Firestore 로드 성공 직후 호출. 쓰로틀 내에서는 스킵.
 * 실패해도 캐시/목록에는 영향 없음.
 */
export const maybeAutoMirrorFirestoreToSheet = async (licenses: License[]): Promise<void> => {
  if (!isGoodFirestoreLicenseSnapshot(licenses)) return;

  let lastAt = 0;
  try {
    lastAt = Number(localStorage.getItem(AUTO_SHEET_MIRROR_AT_KEY) || '0') || 0;
  } catch {
    lastAt = 0;
  }
  if (Date.now() - lastAt < AUTO_SHEET_MIRROR_THROTTLE_MS) {
    console.log('[SheetMirror] throttled — skip auto mirror');
    return;
  }

  try {
    const result = await mirrorFirestoreLicensesToSheet(licenses, { silent: true });
    if (result.ok) {
      try {
        localStorage.setItem(AUTO_SHEET_MIRROR_AT_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    } else {
      console.warn('[SheetMirror] auto mirror skipped:', result.message);
    }
  } catch (err) {
    console.warn('[SheetMirror] auto mirror failed (list/cache unchanged):', err);
  }
};

export const getLastLicenseSyncMeta = (): LicenseSyncMeta => ({ ...lastLicenseSyncMeta });

const readCachedLicenses = (storageKey: string): License[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const countCachedAdmins = (licenses: License[]): number =>
  licenses.filter((l) => l.role === 'ADMIN' && String(l.companyName || '') !== '미지정 회사').length;

export const getPrintWorkLicenses = async (force = false): Promise<License[]> => {
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return [];
  
  const c = getAppConfig();
  const storageKey = `${p.sheetId}_${p.programId}_Licenses`;

  // force여도 실패 시 복원용으로 이전 캐시는 먼저 읽어 둠 (성공 후에만 교체)
  const previousCache = readCachedLicenses(storageKey);
  const previousGoodCache = previousCache.filter(
    (l) => !(l as any).isWebOnly && String(l.companyName || '') !== '미지정 회사'
  );

  await ensureAuth();
  const authenticated = !!auth.currentUser;

  // 1. Fetch from Firestore (SSOT Master) — 재시도 + 부분실패 감지
  let firestoreLicenses: License[] = [];
  let staffLoadFailures: { tenantId: string; name?: string; message: string }[] = [];
  let loadFailureReason: FirestoreLoadFailureReason | null = null;
  let loadErrorMessage = '';
  let firestoreOk = false;

  try {
    const core = await fetchTenantsAndUsersForManager(3);
    if (!core.ok) {
      loadFailureReason = core.failureReason || 'unknown';
      loadErrorMessage = core.errorMessage || 'Firestore 조회 실패';
      console.warn('[ezPrintWorkService] core fetch not ok:', loadFailureReason, loadErrorMessage);
    } else {
      firestoreOk = true;
      const tenants = core.tenants;
      const users = core.users;

    // 각 테넌트 하위의 사내 직원(staff) 서브컬렉션 병렬 일괄 로드
    staffLoadFailures = [];
    const staffPromises = tenants.map(async (t) => {
      try {
        const staffRef = collection(webDb, `tenants/${t.id}/staff`);
        const snap = await getDocs(staffRef);
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err: any) {
        const message = err?.code || err?.message || String(err);
        console.warn(`[ezPrintWorkService] Failed to load staff subcollection for tenant ${t.id}:`, err);
        staffLoadFailures.push({
          tenantId: t.id,
          name: t.name || undefined,
          message,
        });
        return [];
      }
    });
    const staffArrays = await Promise.all(staffPromises);
    const settingsMetaMap = await fetchTenantSettingsMeta(tenants.map(t => t.id));
    const companyInfoMap = new Map<string, string>();
    settingsMetaMap.forEach((meta, id) => {
      if (meta.businessNumber) companyInfoMap.set(id, meta.businessNumber);
    });
    
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
    
    // 1. 대표자(ADMIN) 라이선스 매핑 — 사내 관리자(@ez-hub.kr)는 MEMBER로만 표시
    const adminLicenses: License[] = users
      .filter((u) => isTenantRepresentativeAdminUser(u, tenants))
      .map(u => {
        const tenant = u.tenantId ? tenantMap.get(u.tenantId) : null;
        const planVal = tenant ? tenant.plan : 'free';
        const companyNameVal = tenant ? tenant.name : '미지정 회사';
        const joinCodeVal = tenant ? (tenant as any).joinCode || '' : '';
        const businessNumberVal = tenant ? resolveBusinessNumber(tenant.id, tenant as any, companyInfoMap) : '';
        const expiresAtVal = tenant ? tenant.licenseExpiresAt || null : null;
        let paymentStatusVal = tenant ? (tenant as any).paymentStatus || 'UNPAID' : 'UNPAID';
        // 광고형(무료) B2B 가입사는 2단계 완료 시 FREE로 표시 (UNPAID=가입대기 오해 방지)
        if (tenant && (planVal === 'free' || !planVal) && paymentStatusVal === 'UNPAID') {
          paymentStatusVal = 'FREE';
        }

        const emailLower = u.email ? u.email.trim().toLowerCase() : '';
        const staffDoc = staffMap.get(emailLower) || staffMap.get(u.uid) || staffMap.get(u.id) || null;
        const tenantMeta = tenant ? settingsMetaMap.get(tenant.id) : undefined;
        const companyPhone = tenantMeta?.companyPhone;

        const contactInfoVal = resolveAdminContactInfo(
          u as unknown as Record<string, unknown>,
          staffDoc as unknown as Record<string, unknown> | null,
          companyPhone,
          tenant as unknown as Record<string, unknown> | null | undefined
        );

        const versionVal = tenant
          ? (resolveTenantAppVersion(tenant as unknown as Record<string, unknown>, undefined) || tenantMeta?.appVersion || '')
          : '';

        const positionRaw = (
          staffDoc?.role || 
          staffDoc?.position || 
          u.position || 
          '대표자'
        ).trim();
        const positionVal = (positionRaw === 'admin' || positionRaw === 'staff') ? '대표자' : positionRaw;

        const passwordVal = (
          staffDoc?.password || 
          (u as any).password || 
          ''
        ).trim();

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
              if (!latestTime || d > latestTime) latestTime = d;
            }
          }
        }
        const lastCheckInVal = latestTime ? latestTime.toISOString() : null;
        const isOnlineVal = resolveIsOnline(
          staffDoc as unknown as Record<string, unknown> | null,
          u as unknown as Record<string, unknown>
        );

        return {
          id: u.email || `pw-${u.uid}`,
          adminEmail: u.email,
          email: u.email,
          password: passwordVal,
          userName: (u as any).name || u.userName || u.displayName || '대표자',
          position: positionVal,
          role: 'ADMIN',
          accessLevel: 'owner',
          isCompanyAdmin: true,
          companyName: companyNameVal,
          businessNumber: businessNumberVal,
          joinCode: joinCodeVal,
          plan: planVal === 'pro_plus' ? 'service' : (planVal === 'free' ? 'ad' : planVal),
          paymentStatus: paymentStatusVal as any,
          expiresAt: expiresAtVal,
          contactInfo: contactInfoVal,
          version: versionVal,
          lastCheckIn: lastCheckInVal,
          isOnline: isOnlineVal,
          extensionNumber: staffDoc?.extensionNumber || staffDoc?.extension || '',
          createdAt: u.createdAt || tenant?.createdAt || new Date().toISOString(),
          programId: PROGRAM_IDS.EZPRINTWORK,
          status: LicenseStatus.ACTIVE,
          key: u.email,
          productId: PROGRAM_IDS.EZPRINTWORK,
          type: LicenseType.SUBSCRIPTION
        } as License;
      });

    // 2. 사원(MEMBER) 라이선스 매핑 (각 테넌트의 staff 서브컬렉션에서 매핑)
    const memberLicenses: License[] = [];
    const memberSeenByTenant = new Map<string, Set<string>>();
    tenants.forEach((t, tIdx) => {
      const staffList = staffArrays[tIdx] || [];
      const ownerUser = resolveTenantOwnerUser(t, users);
      const adminEmailVal = ownerUser?.email || '';
      if (!memberSeenByTenant.has(t.id)) memberSeenByTenant.set(t.id, new Set());
      const seenLoginIds = memberSeenByTenant.get(t.id)!;

      staffList.forEach((s: any) => {
        // [FILTER] soft-deleted 되거나 비활성화된 직원은 제외하여 관리자 툴에 유령 직원이 노출되지 않도록 완전 방지
        if (s.isDeleted === true || s.deleted === true || s.active === false) {
          return;
        }

        const isOwner = (s.uid && s.uid === t.ownerId) || 
                        (s.id && s.id === t.ownerId) || 
                        (s.email && s.email.trim().toLowerCase() === adminEmailVal.trim().toLowerCase()) ||
                        (s.loginId && s.loginId.trim().toLowerCase() === adminEmailVal.trim().toLowerCase());
        // 대표는 ADMIN 라이선스 행으로 표시 — 여기서 중복 MEMBER 생성 방지
        if (isOwner) {
          return;
        }

        const linkedUser = users.find(
          (u) =>
            (s.uid && u.uid === s.uid) ||
            (s.id && u.uid === s.id) ||
            (s.loginId && (u as any).loginId && String((u as any).loginId).toLowerCase() === String(s.loginId).toLowerCase())
        );
        const isCompanyAdmin =
          s.isCompanyAdmin === true ||
          s.role === 'admin' ||
          linkedUser?.role === 'admin';

        const dedupeKey = String(s.loginId || s.uid || s.id || s.email || s.name || '')
          .trim()
          .toLowerCase();
        if (dedupeKey && seenLoginIds.has(dedupeKey)) {
          return;
        }
        if (dedupeKey) seenLoginIds.add(dedupeKey);

        // [SSOT 로그인 ID 개편] 실제 B2B 로그인에 사용되는 loginId를 최우선 표기 원천으로 삼고, 없을 때만 email을 폴백합니다.
        let loginIdVal = (s.loginId || '').trim();
        let emailVal = '';
        if (loginIdVal) {
          emailVal = loginIdVal.includes('@') ? loginIdVal : `${loginIdVal}@ez-hub.kr`;
        } else {
          const fallbackEmail = (s.email || s.id || s.uid || `user-${Math.random().toString(36).substr(2, 5)}`).trim();
          emailVal = fallbackEmail.includes('@') ? fallbackEmail : `${fallbackEmail}@ez-hub.kr`;
        }

        const tenantMeta = settingsMetaMap.get(t.id);
        const companyPhone = tenantMeta?.companyPhone;
        const contactInfoVal = resolveStaffContactInfo(
          s as Record<string, unknown>,
          companyPhone
        );

        const positionRaw = (
          s.role || 
          s.position || 
          '직원'
        ).trim();
        const positionVal = (positionRaw === 'admin' || positionRaw === 'staff') ? '사원' : positionRaw;

        const passwordVal = (s.password || '').trim();

        const times = [s.lastLogin, s.lastActive, s.lastCheckIn, s.updatedAt];
        let latestTime: Date | null = null;
        for (const timeVal of times) {
          if (timeVal) {
            const d = new Date(timeVal);
            if (!isNaN(d.getTime())) {
              if (!latestTime || d > latestTime) latestTime = d;
            }
          }
        }
        const lastCheckInVal = latestTime ? latestTime.toISOString() : null;
        const isOnlineVal = resolveIsOnline(s as Record<string, unknown>);

        memberLicenses.push({
          // [H-6 FIX] uid → id → loginId → email 순서로 안정적인 값을 사용하여
          // 매 로드마다 id가 달라지는 버그 해결. Math.random() 완전 제거.
          id: `pw-${s.uid || s.id || s.loginId || (s.email ? s.email.split('@')[0] : null) || `${t.id}-${(s.name || 'member').replace(/\s/g, '_')}`}`,
          adminEmail: adminEmailVal,
          email: emailVal,
          password: passwordVal,
          userName: s.name || s.userName || s.displayName || '사원',
          position: positionVal,
          role: 'MEMBER',
          accessLevel: isCompanyAdmin ? 'company_admin' : 'staff',
          isCompanyAdmin,
          companyName: t.name || '미지정 회사',
          businessNumber: resolveBusinessNumber(t.id, t as any, companyInfoMap),
          joinCode: (t as any).joinCode || '',
          plan: t.plan === 'pro_plus' ? 'service' : (t.plan === 'free' ? 'ad' : t.plan),
          paymentStatus: (t as any).paymentStatus || 'UNPAID',
          expiresAt: t.licenseExpiresAt || null,
          contactInfo: contactInfoVal,
          lastCheckIn: lastCheckInVal,
          isOnline: isOnlineVal,
          extensionNumber: s.extensionNumber || s.extension || '', // [NEW] 내선번호 바인딩 추가
          createdAt: s.createdAt || t.createdAt || new Date().toISOString(),
          programId: PROGRAM_IDS.EZPRINTWORK,
          status: LicenseStatus.ACTIVE,
          key: emailVal,
          productId: PROGRAM_IDS.EZPRINTWORK,
          type: LicenseType.SUBSCRIPTION
        } as License);
      });
    });

    firestoreLicenses = [...adminLicenses, ...memberLicenses];

      // 매핑 후에도 ADMIN이 전부 미지정이면 partial 실패로 간주
      const adminRows = firestoreLicenses.filter((l) => l.role === 'ADMIN');
      const allUnnamed =
        adminRows.length > 0 &&
        adminRows.every((l) => !l.companyName || l.companyName === '미지정 회사');
      if (allUnnamed) {
        firestoreOk = false;
        loadFailureReason = 'partial';
        loadErrorMessage = '회사(tenant) 매칭 실패 — 미지정 폴백 방지';
        firestoreLicenses = [];
      }
    }
  } catch (err) {
    console.error("[ezPrintWorkService] Failed to load data from Firestore:", err);
    firestoreOk = false;
    loadFailureReason = 'unknown';
    loadErrorMessage = String((err as { message?: string })?.message || err);
  }

  // Firestore 실패인데 이전에 정상 캐시가 있으면 → 시트/미지정으로 떨어지지 않고 캐시 유지
  if (!firestoreOk && previousGoodCache.length > 0) {
    lastLicenseSyncMeta = {
      source: 'cache',
      firestoreCount: countCachedAdmins(previousGoodCache),
      memberCount: previousGoodCache.filter((l) => l.role === 'MEMBER').length,
      staffLoadFailures,
      authenticated,
      syncedAt: new Date().toISOString(),
      failureReason: loadFailureReason || 'unknown',
      errorMessage:
        loadErrorMessage ||
        'Firestore 일시 실패 — 이전에 저장된 정상 목록을 표시합니다. 다시 불러와 주세요.',
    };
    return previousGoodCache;
  }

  // 2. Fetch from Google Sheets (Backup mirror / Ledger) with fallback
  let sheetLicenses: License[] = [];
  // Firestore 정상일 때만 시트 스킵. 실패+캐시없음 일 때만 시트 조회.
  if (!firestoreOk && firestoreLicenses.length === 0 && c.clientEmail && c.privateKey && p.sheetId) {
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
  
  const cachedLicenses = previousCache;
  
  // First load sheet rows (or cached rows if Firestore failed)
  const baseLicenses = sheetLicenses.length > 0
    ? sheetLicenses
    : (firestoreOk ? [] : cachedLicenses.filter(c => !(c as any).isWebOnly && String(c.companyName || '') !== '미지정 회사'));
  baseLicenses.forEach(lic => {
    if (lic.email) fusedMap.set(lic.email.toLowerCase(), lic);
  });
  
  // Then overwrite with live Firestore records
  firestoreLicenses.forEach(lic => {
    if (lic.email) {
      const emailLower = lic.email.toLowerCase();
      
      const isAlreadyRegistered = fusedMap.has(emailLower);
      const isFirestoreB2BAdmin =
        lic.role === 'ADMIN' &&
        !!lic.companyName &&
        lic.companyName !== '미지정 회사';
      const isApprovedInCloud = lic.role === 'ADMIN' && (lic.paymentStatus === 'PAID' || lic.paymentStatus === 'FREE');
      
      const isWebOnlyVal = !(isAlreadyRegistered || isFirestoreB2BAdmin || isApprovedInCloud);

      fusedMap.set(emailLower, {
        ...lic,
        isWebOnly: isWebOnlyVal
      } as any);
    }
  });

  const parsed = Array.from(fusedMap.values());

  const adminFirestoreCount = firestoreLicenses.filter((lic) => lic.role === 'ADMIN').length;
  const memberFirestoreCount = firestoreLicenses.filter((lic) => lic.role === 'MEMBER').length;

  if (firestoreOk && adminFirestoreCount > 0) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch { /* ignore */ }
  } else if (!firestoreOk && sheetLicenses.length > 0 && previousGoodCache.length === 0) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch { /* ignore */ }
  }

  lastLicenseSyncMeta = {
    source:
      firestoreOk && adminFirestoreCount > 0
        ? 'firestore'
        : sheetLicenses.length > 0
          ? 'sheet'
          : parsed.length > 0
            ? 'cache'
            : 'empty',
    firestoreCount: adminFirestoreCount,
    memberCount: memberFirestoreCount,
    staffLoadFailures,
    authenticated,
    syncedAt: new Date().toISOString(),
    failureReason: firestoreOk ? null : loadFailureReason,
    errorMessage: firestoreOk ? '' : loadErrorMessage,
  };

  // Firestore SSOT 성공 시에만 시트를 최신으로 미러 (쓰로틀). 실패/부분 데이터는 덮지 않음.
  if (firestoreOk && adminFirestoreCount > 0) {
    void maybeAutoMirrorFirestoreToSheet(parsed);
  }

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

  const lics = await getPrintWorkLicenses(true);
  const emailLower = normalizedLicense.email.toLowerCase();

  const isDuplicate = lics.some(l => {
    if (!l.email || l.email.toLowerCase() !== emailLower) return false;
    if (l.id === normalizedLicense.id) return false;
    if (normalizedLicense.role === 'ADMIN' && l.role === 'ADMIN') return false;
    return true;
  });
  
  if (isDuplicate) {
    const dupCompany = lics.find(l => 
      l.id !== normalizedLicense.id && 
      l.email.toLowerCase() === emailLower &&
      !(normalizedLicense.role === 'ADMIN' && l.role === 'ADMIN')
    )?.companyName || '다른 회사';
    throw new Error(`이미 [${dupCompany}]에서 사용 중인 로그인 ID입니다.`);
  }

  const idx = lics.findIndex(l =>
    l.id === normalizedLicense.id ||
    (normalizedLicense.role === 'ADMIN' && l.role === 'ADMIN' && l.email?.toLowerCase() === emailLower)
  );
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

  // 3. [SSOT 구조 개편] 실시간 구글 시트 동기화 비동기 로직 제거
  // 구글 시트는 이제 수동 백업 및 일일 자동 클라우드 백업으로만 관리됩니다.
};

export const deletePrintWorkLicense = async (id: string, emailHint?: string) => {
  const lics = await getPrintWorkLicenses();
  const target = lics.find(l => l.id === id);
  if (!target) return;

  const filtered = lics.filter(l => l.id !== id);
  const targetEmail = emailHint || target.email || '';
  
  // 1. Direct Blocking Firestore Master Delete (100% ID-based safe deletion)
  try {
    if (targetEmail) {
      const match = await findWebUserByEmail(targetEmail);
      if (match) {
        const { user, tenantId } = match;
        const emailLower = targetEmail.trim().toLowerCase();
        
        // [Safe Isolation] 진짜 활성 춘천인쇄 테넌트 보호 장치 (대표자 이메일만 정밀 보호)
        const isRealActiveTenant = (emailLower === 'ccp5770@gmail.com' || emailLower === 'ccpt78@gmail.com');
        
        if (target.role === 'ADMIN' && tenantId) {
          if (isRealActiveTenant) {
            console.warn(`[SafeDelete] Prevented accidental deletion of real active B2B Tenant: ${targetEmail}`);
          } else {
            await deleteWebTenantDirect(tenantId);
            console.log(`[SafeDelete] Successfully deleted B2B Tenant directly: ${tenantId}`);
          }
        } else if (user.uid) {
          // [C-2 FIX] email도 함께 전달하여 staff 문서 email 기반 fallback 삭제 작동
          await deleteWebUserDirect(user.uid, tenantId, targetEmail);
          console.log(`[SafeDelete] Successfully deleted B2B User safely by ID: ${user.uid}`);
        }
      } else {
        // findWebUserByEmail 실패 시 email 기반 직접 삭제 시도
        console.warn(`[SafeDelete] User not found by email ${targetEmail}, skipping Firestore delete.`);
      }
    }
  } catch (err) {
    console.error(`[ezPrintWorkService] Failed to safely delete Firestore web license for ${targetEmail}:`, err);
  }

  // 2. Instantly Update Local Storage Cache
  const p = getCurrentProgram(PROGRAM_IDS.EZPRINTWORK);
  if (!p) return;
  localStorage.setItem(`${p.sheetId}_${p.programId}_Licenses`, JSON.stringify(filtered));

  // 3. [SSOT 구조 개편] 실시간 구글 시트 Mirror Delete 로직 제거
  // 구글 시트는 이제 수동 백업 및 일일 자동 클라우드 백업으로만 관리됩니다.
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

  // 3. [SSOT 구조 개편] 실시간 구글 시트 Mirror Bulk Delete 로직 제거
  // 구글 시트는 이제 수동 백업 및 일일 자동 클라우드 백업으로만 관리됩니다.
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
        // 시트가 비어 있으면 Firestore → 시트 미러로 복구
        const fromFs = await getPrintWorkLicenses(true);
        if (isGoodFirestoreLicenseSnapshot(fromFs)) {
          const mirrored = await mirrorFirestoreLicensesToSheet(fromFs, { silent: true });
          alert(mirrored.ok ? `시트가 비어 있어 Firestore로 미러했습니다.\n${mirrored.message}` : mirrored.message);
          return;
        }
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
        // 현재 SCHEMA: Firestore SSOT를 시트로 미러 (깨진 시트 내용을 다시 쓰지 않음)
        migratedData = await getPrintWorkLicenses(true);
        if (!isGoodFirestoreLicenseSnapshot(migratedData)) {
          alert('Firestore 목록이 불완전하여 시트 백업을 중단했습니다. 로그인/권한을 확인 후 다시 시도해 주세요.');
          return;
        }
        const mirrored = await mirrorFirestoreLicensesToSheet(migratedData, { silent: true });
        try {
          localStorage.setItem(AUTO_SHEET_MIRROR_AT_KEY, String(Date.now()));
        } catch { /* ignore */ }
        alert(mirrored.ok ? `Firestore → 시트 백업 완료\n${mirrored.message}` : mirrored.message);
        return;
    }

    // 3. 레거시 마이그레이션만 이 경로로 시트 기록
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
