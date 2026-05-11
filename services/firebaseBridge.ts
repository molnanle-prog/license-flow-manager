import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';

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
 * Syncs the Plan status of a user in the Web App's Firestore
 * @param email User's Google Email
 * @param plan 'free' | 'lite' | 'pro' | 'pro_plus'
 */
export const syncWebUserRole = async (email: string, plan: 'free' | 'lite' | 'pro' | 'pro_plus') => {
  if (!email || !email.includes('@')) {
    console.warn("[FirebaseBridge] Invalid email for sync:", email);
    return;
  }

  try {
    console.log(`[FirebaseBridge] Syncing ${email} to ${plan}...`);
    
    // 1. Find user by email in the 'users' collection
    const usersRef = collection(webDb, 'users');
    const q = query(usersRef, where('email', '==', email.trim().toLowerCase()));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.warn(`[FirebaseBridge] User not found in Web App for email: ${email}`);
      return;
    }

    // 2. For each matching user (should be only one), find their tenant and update plan
    for (const userDoc of querySnapshot.docs) {
      const userData = userDoc.data();
      const tenantId = userData.tenantId;

      if (!tenantId) {
        console.warn(`[FirebaseBridge] User ${email} has no tenantId. Cannot upgrade plan.`);
        continue;
      }

      // 3. Update the tenant's plan
      const tenantRef = doc(webDb, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);

      if (tenantSnap.exists()) {
        await updateDoc(tenantRef, { 
          plan: plan,
          updatedAt: new Date().toISOString(),
          upgradedBy: 'LicenseFlowManager'
        });
        console.log(`[FirebaseBridge] Successfully upgraded tenant ${tenantId} to ${plan} for user ${email}`);
      } else {
        console.warn(`[FirebaseBridge] Tenant ${tenantId} not found for user ${email}`);
      }
    }
  } catch (error) {
    console.error("[FirebaseBridge] Sync failed:", error);
    throw error;
  }
};
