const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc, setDoc } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'backportAdminsApp');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("=== Backporting All Admins to Tenant Staff Subcollection ===");

  // 1. Fetch all tenants
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  console.log(`Found ${tenantsSnap.size} tenants.`);

  for (const tenantDoc of tenantsSnap.docs) {
    const tenant = tenantDoc.data();
    const tenantId = tenantDoc.id;
    const ownerId = tenant.ownerId;

    if (!ownerId) {
      console.warn(`Tenant ${tenant.name} (${tenantId}) has no ownerId!`);
      continue;
    }

    console.log(`\nChecking Tenant [${tenant.name}] (${tenantId}) with ownerId [${ownerId}]...`);

    // 2. Fetch admin user profile from global users
    const adminUserDoc = await getDoc(doc(db, 'users', ownerId));
    if (!adminUserDoc.exists()) {
      console.error(`Admin user document ${ownerId} does not exist in users collection!`);
      continue;
    }
    const adminUser = adminUserDoc.data();
    console.log(`Admin user profile found: ${adminUser.name} (${adminUser.email})`);

    // 3. Check if staff record exists for this ownerId
    const staffDocRef = doc(db, `tenants/${tenantId}/staff`, ownerId);
    const staffDoc = await getDoc(staffDocRef);

    if (!staffDoc.exists()) {
      console.log(`Staff record does NOT exist for admin [${adminUser.name}]. Creating one...`);
      const newStaffRecord = {
        id: ownerId,
        uid: ownerId,
        name: adminUser.name || adminUser.userName || '대표자',
        role: adminUser.position || '대표자',
        phone: adminUser.contactInfo || '',
        phoneCompany: adminUser.contactInfo || '',
        avatarUrl: adminUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(adminUser.name || '대표자')}`,
        active: true,
        email: adminUser.email || '',
        loginId: adminUser.loginId || adminUser.email || '',
        password: adminUser.password || '',
        joinDate: adminUser.createdAt || new Date().toISOString()
      };
      await setDoc(staffDocRef, newStaffRecord);
      console.log(`Successfully created staff record for admin:`, newStaffRecord.name);
    } else {
      console.log(`Staff record ALREADY exists for admin [${adminUser.name}]. Updating to ensure active status...`);
      await setDoc(staffDocRef, { active: true }, { merge: true });
    }
  }

  console.log("\n=== Backport Completed Successfully! ===");
}

run().catch(console.error);
