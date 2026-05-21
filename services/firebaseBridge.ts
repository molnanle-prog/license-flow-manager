import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, getDoc, orderBy, deleteDoc, setDoc } from 'firebase/firestore';
import { Tenant, AppUser, License } from '../types';

// Web App Firebase Configuration (from ezprintwork)
const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

// Initialize the second Firebase instance for Web App
const webApp = !getApps().find(app => app.name === 'webBridge') 
  ? initializeApp(webAppConfig, 'webBridge')
  : getApp('webBridge');

export const webDb = getFirestore(webApp, webAppConfig.firestoreDatabaseId);

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
  plan: 'free' | 'lite' | 'pro' | 'pro_plus', 
  expiresAt?: string,
  joinCode?: string,
  companyName?: string,
  businessNumber?: string,
  oldEmail?: string
) => {
  if (!email) return;

  try {
    // [Safe Isolate] Find target tenant ID to avoid global email collisions
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

    // 2. Find the user with the new email
    const match = await findWebUserByEmail(email);
    if (!match || !match.tenantId) {
      console.warn(`[FirebaseBridge] User or Tenant not found for: ${email}`);
      return;
    }

    const tenantRef = doc(webDb, 'tenants', match.tenantId);
    const updateData: any = { 
      plan,
      updatedAt: new Date().toISOString(),
      upgradedBy: 'LicenseFlowManager'
    };

    if (expiresAt !== undefined) {
      updateData.licenseExpiresAt = expiresAt;
    }
    if (joinCode !== undefined) {
      updateData.joinCode = joinCode;
    }
    if (companyName !== undefined) {
      updateData.name = companyName; // In Firestore tenants, company name is stored in 'name'
    }
    if (businessNumber !== undefined) {
      updateData.businessNumber = businessNumber;
    }

    await updateDoc(tenantRef, updateData);
    console.log(`[FirebaseBridge] Successfully updated tenant ${match.tenantId} (Name: ${companyName}, JoinCode: ${joinCode}) for ${email}`);
    return true;
  } catch (error) {
    console.error("[FirebaseBridge] Sync failed:", error);
    throw error;
  }
};

/**
 * Completely deletes a tenant and all its associated users from Firestore
 */
export const deleteWebTenantAndUsers = async (adminEmail: string): Promise<boolean> => {
  if (!adminEmail) return false;

  try {
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

    // 2. Delete the tenant document itself
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
    // 1. Delete all users belonging to this tenant
    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('tenantId', '==', tenantId));
    const snapshot = await getDocs(q);
    
    for (const d of snapshot.docs) {
      await deleteDoc(doc(webDb, 'users', d.id));
      console.log(`[FirebaseBridge] Directly deleted user document: ${d.id} (${d.data().email})`);
    }

    // 2. Delete the tenant document itself
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
    const isNew = !oldEmailTrimmed && !(await findWebUserByEmail(email));

    if (license.role === 'ADMIN') {
      let tenantId: string | null = null;
      let ownerUid: string | null = null;

      // 1. Look up existing tenant or user
      const lookupEmail = oldEmailTrimmed || email;
      const match = await findWebUserByEmail(lookupEmail);
      if (match) {
        tenantId = match.tenantId;
        ownerUid = match.user.uid;
      }

      if (!tenantId && license.joinCode) {
        const snap = await getDocs(query(collection(webDb, 'tenants'), where('joinCode', '==', license.joinCode.trim())));
        if (!snap.empty) {
          tenantId = snap.docs[0].id;
          ownerUid = snap.docs[0].data().ownerId || null;
        }
      }

      if (!tenantId && license.companyName) {
        const snap = await getDocs(query(collection(webDb, 'tenants'), where('name', '==', license.companyName.trim())));
        if (!snap.empty) {
          tenantId = snap.docs[0].id;
          ownerUid = snap.docs[0].data().ownerId || null;
        }
      }

      // Generate random IDs if completely brand new
      if (!tenantId) {
        tenantId = 'tenant-' + Math.random().toString(36).substr(2, 9);
      }
      if (!ownerUid) {
        ownerUid = 'user-' + Math.random().toString(36).substr(2, 9);
      }

      const planMapped = (license.plan === 'service' ? 'pro_plus' : (license.plan === 'ad' ? 'free' : license.plan || 'free')) as 'free' | 'lite' | 'pro' | 'pro_plus';

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
        role: 'admin',
        position: license.position || '대표자',
        contactInfo: license.contactInfo || '',
        createdAt: license.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(userRef, userData, { merge: true });

      console.log(`[FirebaseBridge] Successfully saved ADMIN tenant: ${tenantId} and owner: ${ownerUid}`);
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
