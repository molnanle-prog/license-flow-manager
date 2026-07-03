import { getFirestore, collection, query, where, getDocs, doc, updateDoc, getDoc, orderBy, deleteDoc, setDoc } from 'firebase/firestore';
import { Tenant, AppUser, License } from '../types';
import { app } from '../firebase';
import { ensureFullAuth } from './authService';

const EZPRINTWORK_DB_ID = 'ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755';

export const webDb = getFirestore(app, EZPRINTWORK_DB_ID);

/** 관리 프로그램 plan → EzPrintWork Firestore plan (u1~u10 등 유지) */
export const mapManagerPlanToFirestore = (plan?: string | null): string => {
  const key = String(plan || 'ad').toLowerCase();
  if (key === 'service') return 'pro_plus';
  if (key === 'ad' || key === 'free') return 'free';
  if (/^u\d+$/.test(key)) return key;
  return key || 'free';
};

/** EzPrintWork DB 쓰기 전 Firebase 로그인 */
export const ensureWebBridgeAuth = async (allowPrompt = false): Promise<void> => {
  await ensureFullAuth(allowPrompt);
};

const resolveTenantByJoinCodeOrName = async (
  joinCode?: string,
  companyName?: string
): Promise<{ tenantId: string; ownerId: string | null } | null> => {
  if (joinCode?.trim()) {
    const snap = await getDocs(query(collection(webDb, 'tenants'), where('joinCode', '==', joinCode.trim())));
    if (!snap.empty) {
      const data = snap.docs[0].data();
      return { tenantId: snap.docs[0].id, ownerId: data.ownerId || null };
    }
  }
  if (companyName?.trim()) {
    const snap = await getDocs(query(collection(webDb, 'tenants'), where('name', '==', companyName.trim())));
    if (!snap.empty) {
      const data = snap.docs[0].data();
      return { tenantId: snap.docs[0].id, ownerId: data.ownerId || null };
    }
  }
  return null;
};

/**
 * All Tenants from Firebase Firestore
 */
export const getAllTenants = async (): Promise<Tenant[]> => {
  try {
    const tenantsRef = collection(webDb, 'tenants');
    const q = query(tenantsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tenant));
  } catch (error) {
    console.error("[FirebaseBridge] Failed to fetch tenants:", error);
    return [];
  }
};

export type TenantSettingsMeta = {
  businessNumber?: string;
  companyPhone?: string;
  appVersion?: string;
};

const pickCompanyPhone = (...sources: Array<Record<string, unknown> | undefined>): string => {
  for (const data of sources) {
    if (!data) continue;
    const direct = String(
      data.phone || data.companyPhone || data.tel || data.contactPhone || ''
    ).trim();
    if (direct) return direct;
    const ci = data.companyInfo as Record<string, unknown> | undefined;
    if (ci) {
      const nested = String(
        ci.phone || ci.companyPhone || ci.tel || ci.contactPhone || ''
      ).trim();
      if (nested) return nested;
    }
  }
  return '';
};

const pickTenantAppVersion = (data: Record<string, unknown>): string => {
  const stats = data.stats as Record<string, unknown> | undefined;
  return String(
    data.appVersion
    || data.clientVersion
    || data.lastAppVersion
    || data.ezprintVersion
    || stats?.appVersion
    || ''
  ).trim().replace(/^v/i, '');
};

/** EzPrintWork tenant settings meta (business number, company phone, client version) */
export const fetchTenantSettingsMeta = async (tenantIds: string[]): Promise<Map<string, TenantSettingsMeta>> => {
  const map = new Map<string, TenantSettingsMeta>();
  try {
    await ensureWebBridgeAuth(false);
  } catch {
    /* 읽기 전용 — 로그인 없으면 tenant 루트만 사용 */
  }
  await Promise.all(tenantIds.map(async (id) => {
    try {
      const meta: TenantSettingsMeta = {};
      let tenantData: Record<string, unknown> | undefined;
      const tenantSnap = await getDoc(doc(webDb, 'tenants', id));
      if (tenantSnap.exists()) {
        tenantData = tenantSnap.data() as Record<string, unknown>;
        const rootBn = String(tenantData.businessNumber || '').trim();
        if (rootBn) meta.businessNumber = rootBn;
        const rootVersion = pickTenantAppVersion(tenantData);
        if (rootVersion) meta.appVersion = rootVersion;
      }

      let ciData: Record<string, unknown> | undefined;
      const ciSnap = await getDoc(doc(webDb, 'tenants', id, 'settings', 'companyInfo'));
      if (ciSnap.exists()) {
        ciData = ciSnap.data() as Record<string, unknown>;
        if (!meta.businessNumber) {
          const bn = String(
            ciData.businessNumber || ciData.businessRegistrationNumber || ''
          ).trim();
          if (bn) meta.businessNumber = bn;
        }
      }

      let mainData: Record<string, unknown> | undefined;
      const mainSnap = await getDoc(doc(webDb, 'tenants', id, 'settings', 'main'));
      if (mainSnap.exists()) {
        mainData = mainSnap.data() as Record<string, unknown>;
        if (!meta.businessNumber) {
          const mainCi = mainData.companyInfo as Record<string, unknown> | undefined;
          const bn = String(
            mainCi?.businessNumber
            || mainData.businessNumber
            || mainCi?.businessRegistrationNumber
            || ''
          ).trim();
          if (bn) meta.businessNumber = bn;
        }
      }

      const companyPhone = pickCompanyPhone(ciData, mainData, tenantData);
      if (companyPhone) meta.companyPhone = companyPhone;

      if (meta.businessNumber || meta.companyPhone || meta.appVersion) {
        map.set(id, meta);
      }
    } catch (err) {
      console.warn(`[FirebaseBridge] tenant settings read failed for tenant ${id}:`, err);
    }
  }));
  return map;
};

/** EzPrintWork 회사정보(settings/companyInfo)에서 사업자번호를 일괄 조회 */
export const fetchCompanyInfoBusinessNumbers = async (tenantIds: string[]): Promise<Map<string, string>> => {
  const metaMap = await fetchTenantSettingsMeta(tenantIds);
  const map = new Map<string, string>();
  metaMap.forEach((meta, id) => {
    if (meta.businessNumber) map.set(id, meta.businessNumber);
  });
  return map;
};

export const resolveBusinessNumber = (
  tenantId: string,
  tenant: { businessNumber?: string } | null | undefined,
  companyInfoMap: Map<string, string>
): string => {
  const root = String(tenant?.businessNumber || '').trim();
  if (root) return root;
  return companyInfoMap.get(tenantId) || '';
};

/** tenant 루트 businessNumber가 비어 있으면 companyInfo 값으로 보강 */
export const enrichTenantsWithBusinessNumbers = async (tenants: Tenant[]): Promise<Tenant[]> => {
  if (tenants.length === 0) return tenants;
  const companyInfoMap = await fetchCompanyInfoBusinessNumbers(tenants.map(t => t.id));
  return tenants.map(t => {
    const resolved = resolveBusinessNumber(t.id, t as any, companyInfoMap);
    if (resolved && !String((t as any).businessNumber || '').trim()) {
      return { ...t, businessNumber: resolved } as Tenant;
    }
    return t;
  });
};

/** 관리 프로그램에서 저장 시 EzPrintWork 회사정보에도 사업자번호 동기화 */
export const syncBusinessNumberToCompanyInfo = async (tenantId: string, businessNumber: string): Promise<void> => {
  const bn = businessNumber.trim();
  if (!tenantId || !bn) return;
  try {
    const ciRef = doc(webDb, 'tenants', tenantId, 'settings', 'companyInfo');
    const ciSnap = await getDoc(ciRef);
    const existingName = ciSnap.exists() ? String(ciSnap.data().name || '').trim() : '';
    await setDoc(ciRef, {
      ...(existingName ? { name: existingName } : {}),
      businessNumber: bn
    }, { merge: true });
  } catch (err) {
    console.warn(`[FirebaseBridge] syncBusinessNumberToCompanyInfo failed for ${tenantId}:`, err);
  }
};

/**
 * All Users from Firebase Firestore
 */
export const getAllWebUsers = async (): Promise<AppUser[]> => {
  try {
    const usersRef = collection(webDb, 'users');
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser));
  } catch (error) {
    console.error("[FirebaseBridge] Failed to fetch users:", error);
    return [];
  }
};

/**
 * Find a user and their tenant ID by email
 */
export const findWebUserByEmail = async (email: string): Promise<{ user: AppUser, tenantId: string } | null> => {
  if (!email || !email.includes('@')) return null;
  
  try {
    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('email', '==', email.trim().toLowerCase()));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return null;
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data() as AppUser;
    return { user: userData, tenantId: userData.tenantId || '' };
  } catch (error) {
    console.error("[FirebaseBridge] Search failed:", error);
    return null;
  }
};

/**
 * Syncs the Plan status of a user in the Web App's Firestore
 */
export const syncWebUserRole = async (
  email: string, 
  plan: string, 
  expiresAt?: string,
  joinCode?: string,
  companyName?: string,
  businessNumber?: string,
  oldEmail?: string,
  paymentStatus?: string
) => {
  if (!email) return;

  try {
    await ensureWebBridgeAuth(true);

    // [Safe Isolate] joinCode / 회사명으로 테넌트 우선 매칭 (이메일 충돌 방지)
    let targetTenantId: string | null = null;
    if (joinCode) {
      const snap = await getDocs(query(collection(webDb, 'tenants'), where('joinCode', '==', joinCode.trim())));
      if (!snap.empty) targetTenantId = snap.docs[0].id;
    }
    if (!targetTenantId && companyName) {
      const snap = await getDocs(query(collection(webDb, 'tenants'), where('name', '==', companyName.trim())));
      if (!snap.empty) targetTenantId = snap.docs[0].id;
    }

    // 1. If oldEmail is provided and differs from email, update the user email in the users collection first.
    if (oldEmail && oldEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      if (targetTenantId) {
        const usersRef = collection(webDb, 'users');
        const q = query(
          usersRef, 
          where('email', '==', oldEmail.trim().toLowerCase()), 
          where('tenantId', '==', targetTenantId)
        );
        const userSnapshot = await getDocs(q);
        
        if (!userSnapshot.empty) {
          for (const userDoc of userSnapshot.docs) {
            const userDocRef = doc(webDb, 'users', userDoc.id);
            await updateDoc(userDocRef, {
              email: email.trim().toLowerCase(),
              updatedAt: new Date().toISOString()
            });
            console.log(`[FirebaseBridge] Updated user email from ${oldEmail} to ${email} for user UID: ${userDoc.id} in tenant: ${targetTenantId}`);
          }
        } else {
          console.warn(`[FirebaseBridge] No user found with email: ${oldEmail} in tenant: ${targetTenantId} to update email to: ${email}`);
        }
      } else {
        console.warn(`[FirebaseBridge] Skip email update because no matching target tenant was found for joinCode: ${joinCode} or companyName: ${companyName}`);
      }
    }

    // 2. 업데이트 대상 테넌트 결정 (joinCode/회사명 우선, 없으면 이메일로 fallback)
    let tenantIdToUpdate = targetTenantId;
    if (!tenantIdToUpdate) {
      const match = await findWebUserByEmail(email);
      tenantIdToUpdate = match?.tenantId || null;
    }

    if (!tenantIdToUpdate) {
      console.warn(`[FirebaseBridge] Tenant not found for: ${email} (joinCode: ${joinCode}, company: ${companyName})`);
      return;
    }

    const tenantRef = doc(webDb, 'tenants', tenantIdToUpdate);
    const planValue = mapManagerPlanToFirestore(plan);
    const updateData: Record<string, unknown> = { 
      plan: planValue,
      updatedAt: new Date().toISOString(),
      upgradedBy: 'LicenseFlowManager'
    };

    if (paymentStatus !== undefined) {
      updateData.paymentStatus = paymentStatus;
    }
    if (expiresAt !== undefined) {
      updateData.licenseExpiresAt = expiresAt;
    }
    if (joinCode !== undefined) {
      updateData.joinCode = joinCode;
    }
    if (companyName !== undefined) {
      updateData.name = companyName;
    }
    if (businessNumber !== undefined) {
      updateData.businessNumber = businessNumber;
    }

    await updateDoc(tenantRef, updateData);
    if (businessNumber !== undefined && businessNumber.trim()) {
      await syncBusinessNumberToCompanyInfo(tenantIdToUpdate, businessNumber);
    }
    console.log(`[FirebaseBridge] Successfully updated tenant ${tenantIdToUpdate} plan=${plan} payment=${paymentStatus} (Name: ${companyName}, JoinCode: ${joinCode})`);
    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Sync failed:", error);
    throw error;
  }
};

/**
 * [내부 유틸] 테넌트의 모든 서브컬렉션 데이터를 완전히 삭제합니다.
 * Firestore는 상위 문서를 삭제해도 서브컬렉션이 자동으로 삭제되지 않으므로 명시적으로 처리해야 합니다. [C-3 FIX]
 */
const TENANT_SUB_COLLECTIONS = [
  'staff', 'jobs', 'clients', 'customers', 'settings', 'backups',
  'instructions', 'quotes', 'messages', 'joinRequests', 'leaves', 'papers',
];

const deleteTenantSubCollections = async (tenantId: string): Promise<void> => {
  for (const sub of TENANT_SUB_COLLECTIONS) {
    try {
      const subRef = collection(webDb, `tenants/${tenantId}/${sub}`);
      const snap = await getDocs(subRef);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
        console.log(`[FirebaseBridge] Deleted subcollection doc: tenants/${tenantId}/${sub}/${d.id}`);
      }
    } catch (subErr) {
      console.warn(`[FirebaseBridge] Failed to delete subcollection ${sub} for tenant ${tenantId}:`, subErr);
    }
  }
};

/**
 * Completely deletes a tenant and all its associated users from Firestore
 */
export const deleteWebTenantAndUsers = async (adminEmail: string): Promise<boolean> => {
  if (!adminEmail) return false;

  try {
    await ensureWebBridgeAuth(true);
    const match = await findWebUserByEmail(adminEmail);
    if (!match || !match.tenantId) {
      console.warn(`[FirebaseBridge] No web tenant found for email: ${adminEmail}`);
      return false;
    }

    const tenantId = match.tenantId;

    // 1. Delete all users belonging to this tenant
    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    
    for (const d of snapshot.docs) {
      await deleteDoc(doc(webDb, 'users', d.id));
      console.log(`[FirebaseBridge] Deleted user document: ${d.id} (${d.data().email})`);
    }

    // 2. [C-3 FIX] Delete all subcollections before deleting the tenant document
    await deleteTenantSubCollections(tenantId);

    // 3. Delete the tenant document itself
    const tenantRef = doc(webDb, 'tenants', tenantId);
    await deleteDoc(tenantRef);
    console.log(`[FirebaseBridge] Deleted tenant document: ${tenantId}`);

    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Failed to delete web tenant and users:", error);
    throw error;
  }
};

/**
 * Deletes a single user from Firestore
 */
export const deleteWebUser = async (email: string): Promise<boolean> => {
  if (!email) return false;

  try {
    const match = await findWebUserByEmail(email);
    if (!match) {
      console.warn(`[FirebaseBridge] No web user found for email: ${email}`);
      return false;
    }

    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('email', '==', email.trim().toLowerCase()));
    const snapshot = await getDocs(q);

    for (const d of snapshot.docs) {
      await deleteDoc(doc(webDb, 'users', d.id));
      console.log(`[FirebaseBridge] Deleted user document: ${d.id} (${email})`);
    }

    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Failed to delete web user:", error);
    throw error;
  }
};

/**
 * Directly deletes a tenant by ID and all users belonging to that tenant
 */
export const deleteWebTenantDirect = async (tenantId: string): Promise<boolean> => {
  if (!tenantId) return false;

  try {
    await ensureWebBridgeAuth(true);
    // 1. Delete all users belonging to this tenant
    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    
    for (const d of snapshot.docs) {
      await deleteDoc(doc(webDb, 'users', d.id));
      console.log(`[FirebaseBridge] Directly deleted user document: ${d.id} (${d.data().email})`);
    }

    // 2. [C-3 FIX] Delete all subcollections (staff/jobs/customers/settings) before deleting the tenant document
    // Firestore does NOT auto-delete subcollections when a parent document is deleted.
    await deleteTenantSubCollections(tenantId);

    // 3. Delete the tenant document itself
    const tenantRef = doc(webDb, 'tenants', tenantId);
    await deleteDoc(tenantRef);
    console.log(`[FirebaseBridge] Directly deleted tenant document: ${tenantId}`);

    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Directly failed to delete web tenant and users:", error);
    throw error;
  }
};

/**
 * Initial definitions for newly created tenants to match EzPrintWork default state
 */
const INITIAL_STATUS_DEFINITIONS = [
  { key: 'RECEIVED', label: '접수' },
  { key: 'DESIGN', label: '디자인' },
  { key: 'PRINTING', label: '인쇄' },
  { key: 'POST_PROCESSING', label: '후가공' },
  { key: 'DELIVERY', label: '납품/완료' }
];

const INITIAL_PRODUCT_DEFINITIONS = [
  {
    name: '명함',
    sizes: ['90x50mm(기본)', '86x52mm(신용카드)', '85x55mm', '90x55mm', '규격외'],
    paperTypes: ['스노우지(일반)', '반누보(수입지)', '휘라레', '스타드림', '크라프트지', '엑스트라매트', '마시멜로우', '띤또레또', '팝셋', '키칼라', '빌리지'],
    paperWeights: ['216g', '250g', '300g', '350g', '400g']
  },
  {
    name: '전단지',
    sizes: ['A4 (210x297)', 'A5 (148x210)', 'A3 (297x420)', 'B4 (257x364)', 'B5 (182x257)', '규격외'],
    paperTypes: ['아트지', '스노우지', '모조지'],
    paperWeights: ['80g', '100g', '120g', '150g', '180g', '250g']
  },
  {
    name: '스티커',
    sizes: ['90x55mm', '원형 50mm', '원형 40mm', '사각 50x50mm', '규격외'],
    paperTypes: ['강접 아트지', '모조지', '유포지', '투명데드롱', '은광데드롱', '크라프트지'],
    paperWeights: ['일반', '강접']
  },
  {
    name: '봉투',
    sizes: ['대봉투 (245x330)', '중봉투 (175x235)', '소봉투 (220x105)', '체크봉투'],
    paperTypes: ['모조지(백색)', '체크레자크', '줄레자크', '탄트지', '밍크지'],
    paperWeights: ['100g', '120g', '150g']
  }
];

/**
 * Saves a License object directly to Firestore (SSOT Master Write)
 */
export const saveWebLicenseToFirestore = async (license: License, oldEmail?: string): Promise<boolean> => {
  if (!license || !license.email) return false;

  const email = license.email.trim().toLowerCase();
  const oldEmailTrimmed = oldEmail ? oldEmail.trim().toLowerCase() : undefined;

  try {
    await ensureWebBridgeAuth(true);
    const isNew = !oldEmailTrimmed && !(await findWebUserByEmail(email));

    if (license.role === 'ADMIN') {
      let tenantId: string | null = null;
      let ownerUid: string | null = null;

      // 1. 입장코드/회사명 우선 (이메일 중복·유령 테넌트 방지)
      const resolved = await resolveTenantByJoinCodeOrName(license.joinCode, license.companyName);
      if (resolved) {
        tenantId = resolved.tenantId;
        ownerUid = resolved.ownerId;
      }

      if (!tenantId) {
        const lookupEmail = oldEmailTrimmed || email;
        const match = await findWebUserByEmail(lookupEmail);
        if (match) {
          tenantId = match.tenantId;
          ownerUid = match.user.uid;
        }
      }

      // Generate random IDs if completely brand new
      if (!tenantId) {
        tenantId = 'tenant-' + Math.random().toString(36).substr(2, 9);
      }
      if (!ownerUid) {
        ownerUid = 'user-' + Math.random().toString(36).substr(2, 9);
      }

      const planMapped = mapManagerPlanToFirestore(license.plan);

      // 2. Set/Update Tenant document
      const tenantRef = doc(webDb, 'tenants', tenantId);
      const tenantData: any = {
        id: tenantId,
        name: license.companyName || '미지정 회사',
        ownerId: ownerUid,
        plan: planMapped,
        licenseExpiresAt: license.expiresAt || null,
        paymentStatus: license.paymentStatus || 'UNPAID',
        createdAt: license.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        joinCode: license.joinCode || 'temp' + Math.floor(1000 + Math.random() * 9000),
        businessNumber: license.businessNumber || ''
      };
      await setDoc(tenantRef, tenantData, { merge: true });
      if (license.businessNumber?.trim()) {
        await syncBusinessNumberToCompanyInfo(tenantId, license.businessNumber);
      }

      // 3. Initialize settings documents for new tenants
      if (isNew) {
        const settingsRef = (s: string) => doc(webDb, `tenants/${tenantId}/settings`, s);
        await setDoc(settingsRef('statusDefinitions'), { definitions: INITIAL_STATUS_DEFINITIONS }, { merge: true });
        await setDoc(settingsRef('productDefinitions'), { definitions: INITIAL_PRODUCT_DEFINITIONS }, { merge: true });
        await setDoc(settingsRef('pricing'), { baseLaborCost: 10000, printColorCost: 50, marginRate: 1.6 }, { merge: true });
        await setDoc(settingsRef('roles'), { roles: ["관리자", "디자이너", "인쇄기장", "후가공", "배송"] }, { merge: true });
      }

      // 4. Set/Update User document in global users collection
      const userRef = doc(webDb, 'users', ownerUid);
      const userData = {
        uid: ownerUid,
        id: ownerUid,
        tenantId: tenantId,
        email: email,
        loginId: license.email.trim(),
        password: license.password ? license.password.trim() : '',
        userName: license.userName || '웹 가입자',
        name: license.userName || '웹 가입자',
        displayName: license.userName || '웹 가입자',
        role: 'admin',
        position: license.position || '대표자',
        contactInfo: license.contactInfo || '',
        createdAt: license.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(userRef, userData, { merge: true });

      // [SSOT 구조 고도화] 대표자 계정 또한 B2B 앱 내의 직원 리스트(tenants/{tenantId}/staff)에 자동으로 실시간 등재하여,
      // 내선 번호 설정, 대표 본인의 작업/로그 바인딩, 그리고 5인 무료 라이선스 슬롯 낭비 원천 차단을 실현합니다.
      const staffRef = doc(webDb, `tenants/${tenantId}/staff`, ownerUid);
      await setDoc(staffRef, {
        id: ownerUid,
        uid: ownerUid,
        name: license.userName || '대표자',
        role: license.position || '대표자',
        phone: license.contactInfo || '',
        phoneCompany: license.contactInfo || '',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(license.userName || '대표자')}`,
        active: true,
        email: email,
        loginId: license.email.trim(),
        password: license.password ? license.password.trim() : '',
        joinDate: license.createdAt || new Date().toISOString()
      }, { merge: true });

      console.log(`[FirebaseBridge] Successfully saved ADMIN tenant: ${tenantId}, owner: ${ownerUid}, and registered admin as staff member.`);
      return true;

    } else {
      // MEMBER / STAFF role
      let tenantId: string | null = null;

      // Find the parent tenant using adminEmail
      if (license.adminEmail) {
        const adminMatch = await findWebUserByEmail(license.adminEmail);
        if (adminMatch) {
          tenantId = adminMatch.tenantId;
        }
      }

      if (!tenantId && license.companyName) {
        const snap = await getDocs(query(collection(webDb, 'tenants'), where('name', '==', license.companyName.trim())));
        if (!snap.empty) {
          tenantId = snap.docs[0].id;
        }
      }

      if (!tenantId) {
        console.error(`[FirebaseBridge] Cannot save MEMBER because no tenant was found for adminEmail: ${license.adminEmail}`);
        return false;
      }

      let memberUid: string | null = null;
      const lookupEmail = oldEmailTrimmed || email;
      const memberMatch = await findWebUserByEmail(lookupEmail);
      if (memberMatch) {
        memberUid = memberMatch.user.uid;
      } else {
        memberUid = 'user-' + Math.random().toString(36).substr(2, 9);
      }

      // 1. Save to global users collection
      const userRef = doc(webDb, 'users', memberUid);
      const userData = {
        uid: memberUid,
        id: memberUid,
        tenantId: tenantId,
        email: email,
        loginId: license.email.trim(),
        password: license.password ? license.password.trim() : '',
        userName: license.userName || '사원',
        name: license.userName || '사원',
        role: 'staff',
        position: license.position || '',
        contactInfo: license.contactInfo || '',
        createdAt: license.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(userRef, userData, { merge: true });

      // 2. Save to tenant staff subcollection
      const staffRef = doc(webDb, `tenants/${tenantId}/staff`, memberUid);
      await setDoc(staffRef, {
        id: memberUid,
        uid: memberUid,
        name: license.userName || '사원',
        role: license.position || '',
        phone: license.contactInfo || '',
        phoneCompany: license.contactInfo || '', // 회사 휴대폰 필드 우선 저장 보장
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(license.userName || '')}`,
        active: true,
        email: email,
        loginId: license.email.trim(),
        password: license.password ? license.password.trim() : '',
        joinDate: license.createdAt || new Date().toISOString()
      }, { merge: true });

      console.log(`[FirebaseBridge] Successfully saved MEMBER user: ${memberUid} in tenant: ${tenantId}`);
      return true;
    }
  } catch (error) {
    console.error("[FirebaseBridge] Direct Firestore save failed:", error);
    throw error;
  }
};

/**
 * Deletes a license (tenant/user or member) directly from Firestore (SSOT Master Delete)
 */
export const deleteWebLicenseFromFirestore = async (email: string, role: string): Promise<boolean> => {
  if (!email) return false;

  try {
    const match = await findWebUserByEmail(email);
    if (!match) {
      console.warn(`[FirebaseBridge] No user found to delete for email: ${email}`);
      return false;
    }

    if (role === 'ADMIN' && match.tenantId) {
      // Completely delete tenant and all associated users
      return await deleteWebTenantDirect(match.tenantId);
    } else {
      // Delete single staff member from global users and tenant staff subcollection
      const uid = match.user.uid;
      await deleteDoc(doc(webDb, 'users', uid));
      console.log(`[FirebaseBridge] Deleted user document from global users: ${uid}`);

      if (match.tenantId) {
        await deleteDoc(doc(webDb, `tenants/${match.tenantId}/staff`, uid));
        console.log(`[FirebaseBridge] Deleted staff document from tenants/${match.tenantId}/staff: ${uid}`);
      }
      return true;
    }
  } catch (error) {
    console.error("[FirebaseBridge] Direct Firestore delete failed:", error);
    throw error;
  }
};

/**
 * Deletes a single user/staff member safely using their direct UID and tenantId,
 * avoiding email-based broad deletions that cause catastrophic accidental data loss.
 * [C-2 FIX] Also queries staff subcollection by email as a fallback,
 * because staff document IDs may not always match the UID.
 */
export const deleteWebUserDirect = async (uid: string, tenantId: string, email?: string): Promise<boolean> => {
  if (!uid) return false;

  try {
    // 1. Delete from global users collection
    try {
      await deleteDoc(doc(webDb, 'users', uid));
      console.log(`[FirebaseBridge] Safely deleted user document from global users: ${uid}`);
    } catch (userErr) {
      console.warn(`[FirebaseBridge] Could not delete user doc ${uid} from global users (may not exist):`, userErr);
    }

    // 2. Delete from tenant staff subcollection
    if (tenantId) {
      // 2-a. Try direct UID-based delete first (fast path)
      try {
        await deleteDoc(doc(webDb, `tenants/${tenantId}/staff`, uid));
        console.log(`[FirebaseBridge] Safely deleted staff document (by uid) from tenants/${tenantId}/staff: ${uid}`);
      } catch (staffErr) {
        console.warn(`[FirebaseBridge] UID-based staff delete failed for ${uid}:`, staffErr);
      }

      // 2-b. [C-2 FIX] Fallback: query staff by uid field to catch mismatched document IDs
      try {
        const staffRef = collection(webDb, `tenants/${tenantId}/staff`);
        const qByUid = query(staffRef, where('uid', '==', uid));
        const snapByUid = await getDocs(qByUid);
        for (const d of snapByUid.docs) {
          if (d.id !== uid) { // already deleted above, skip duplicates
            await deleteDoc(d.ref);
            console.log(`[FirebaseBridge] Fallback-deleted staff doc (uid field match) from tenants/${tenantId}/staff: ${d.id}`);
          }
        }
      } catch (qErr) {
        console.warn(`[FirebaseBridge] uid-field query fallback failed for tenant ${tenantId}:`, qErr);
      }

      // 2-c. [C-2 FIX] If email is provided, also delete any staff doc matching that email
      if (email) {
        try {
          const staffRef = collection(webDb, `tenants/${tenantId}/staff`);
          const qByEmail = query(staffRef, where('email', '==', email.trim().toLowerCase()));
          const snapByEmail = await getDocs(qByEmail);
          for (const d of snapByEmail.docs) {
            await deleteDoc(d.ref);
            console.log(`[FirebaseBridge] Fallback-deleted staff doc (email match) from tenants/${tenantId}/staff: ${d.id}`);
          }
        } catch (eErr) {
          console.warn(`[FirebaseBridge] email-field query fallback failed for tenant ${tenantId}:`, eErr);
        }
      }
    }
    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Safe user deletion failed:", error);
    throw error;
  }
};

/**
 * 구글 시트 백업본 등을 기반으로 파이어베이스 Firestore B2B 테넌트 및 사원 정보를 일괄 복원합니다.
 */
export const restoreWebDatabaseFromBackup = async (backupData: { tenants: Tenant[], users: AppUser[], staff: { [tenantId: string]: any[] } }): Promise<boolean> => {
  try {
    console.log("[FirebaseBridge] Starting Firebase restoration database transaction...");
    
    // 1. Restore Tenants
    if (Array.isArray(backupData.tenants)) {
      for (const t of backupData.tenants) {
        if (!t.id) continue;
        await setDoc(doc(webDb, 'tenants', t.id), t, { merge: true });
        console.log(`[FirebaseBridge] Restored tenant: ${t.id} (${t.name})`);
      }
    }

    // 2. Restore Users
    if (Array.isArray(backupData.users)) {
      for (const u of backupData.users) {
        if (!u.uid) continue;
        await setDoc(doc(webDb, 'users', u.uid), u, { merge: true });
        console.log(`[FirebaseBridge] Restored global user: ${u.uid} (${u.email})`);
      }
    }

    // 3. Restore Staff subcollections
    if (backupData.staff && typeof backupData.staff === 'object') {
      for (const [tenantId, staffList] of Object.entries(backupData.staff)) {
        if (!Array.isArray(staffList)) continue;
        for (const s of staffList) {
          if (!s.id) continue;
          await setDoc(doc(webDb, `tenants/${tenantId}/staff`, s.id), s, { merge: true });
          console.log(`[FirebaseBridge] Restored staff member: ${s.id} in tenant: ${tenantId}`);
        }
      }
    }

    console.log("[FirebaseBridge] Firebase restoration transaction completed successfully.");
    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Restoration database transaction failed:", error);
    throw error;
  }
};

/**
 * [실시간 결제 만료 자동 강등 엔진]
 * 만료일이 경과한 유료 테넌트를 감지하여 광고형 플랜(free)으로 자동 강등합니다.
 *
 * [H-5 FIX] 변경 사항:
 * - paymentStatus 단독 조건 제거: 만료일 없이 UNPAID라는 이유만으로 강등하지 않음.
 *   (결제 완료 고객이 실수로 강등되던 버그 수정)
 * - 하루 1회 실행 제한: localStorage에 마지막 실행 시각을 기록하여
 *   loadWebData 호출마다 전체 테넌트를 순회하던 Firestore 과금 문제 방지.
 */
const AUTO_DOWNGRADE_LAST_RUN_KEY = 'autoDowngrade_lastRunAt';
const AUTO_DOWNGRADE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간

export const autoDowngradeExpiredTenants = async (): Promise<{ downgradedCount: number }> => {
  // [H-5 FIX] 마지막 실행 시각 확인 — 24시간 이내 실행된 경우 스킵
  const lastRunStr = localStorage.getItem(AUTO_DOWNGRADE_LAST_RUN_KEY);
  if (lastRunStr) {
    const lastRun = new Date(lastRunStr).getTime();
    if (!isNaN(lastRun) && Date.now() - lastRun < AUTO_DOWNGRADE_INTERVAL_MS) {
      console.log(`[AutoDowngrade] 마지막 실행 후 24시간 미경과, 스킵합니다. (마지막 실행: ${lastRunStr})`);
      return { downgradedCount: 0 };
    }
  }

  // 실행 시각 기록
  localStorage.setItem(AUTO_DOWNGRADE_LAST_RUN_KEY, new Date().toISOString());

  try {
    const tenantsRef = collection(webDb, 'tenants');
    const snapshot = await getDocs(tenantsRef);
    const now = new Date();
    let downgradedCount = 0;

    for (const tenantDoc of snapshot.docs) {
      const tenantData = tenantDoc.data() as Tenant;
      const tenantId = tenantDoc.id;
      
      const plan = tenantData.plan || 'free';
      const licenseExpiresAt = tenantData.licenseExpiresAt || null;

      const isPaidPlan = ['pro', 'pro_plus', 'service'].includes(plan) || /^u\d+$/i.test(plan);
      if (!isPaidPlan) continue; // 이미 free이거나 광고형이면 스킵

      let shouldDowngrade = false;

      // [H-5 FIX] 강등 조건: 만료일이 존재하고 현재 시각보다 이전인 경우에만 강등
      // (paymentStatus 단독 조건 제거 — PAID/FREE 여부와 무관하게 만료일 기준으로만 판단)
      if (licenseExpiresAt) {
        const expireDate = new Date(licenseExpiresAt);
        if (!isNaN(expireDate.getTime()) && expireDate < now) {
          shouldDowngrade = true;
          console.log(`[AutoDowngrade] Tenant ${tenantData.name} (${tenantId}) 만료일 경과 감지: ${licenseExpiresAt}`);
        }
      }
      // 만료일 없는 유료 플랜 = 무기한 사용 허가 (강등 안 함)

      if (shouldDowngrade) {
        const tenantDocRef = doc(webDb, 'tenants', tenantId);
        await updateDoc(tenantDocRef, {
          plan: 'free',
          paymentStatus: 'UNPAID',
          updatedAt: now.toISOString(),
          upgradedBy: 'AutoDowngradeEngine'
        });
        
        downgradedCount++;
        console.log(`[AutoDowngrade] Tenant ${tenantData.name} (${tenantId})가 광고형 플랜으로 자동 강등 처리되었습니다.`);
      }
    }

    return { downgradedCount };
  } catch (error) {
    console.error("[AutoDowngrade] Failed to execute auto-downgrade batch:", error);
    return { downgradedCount: 0 };
  }
};


