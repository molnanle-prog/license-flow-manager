import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, getDoc, orderBy, deleteDoc } from 'firebase/firestore';
import { Tenant, AppUser } from '../types';

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
export const syncWebUserRole = async (email: string, plan: 'free' | 'lite' | 'pro' | 'pro_plus', expiresAt?: string) => {
  if (!email) return;

  try {
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

    if (expiresAt) {
      updateData.licenseExpiresAt = expiresAt;
    }

    await updateDoc(tenantRef, updateData);
    console.log(`[FirebaseBridge] Successfully updated tenant ${match.tenantId} for ${email}`);
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
