const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'checkStaffAppCJS');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  console.log("Fetching all tenants...");
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  const tenants = tenantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  console.log(`Found ${tenants.length} tenants. Checking staff subcollections...`);
  
  for (const tenant of tenants) {
    const staffRef = collection(db, `tenants/${tenant.id}/staff`);
    const staffSnap = await getDocs(staffRef);
    const staffList = staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (staffList.length > 0) {
      console.log(`\nTenant [${tenant.name}] (${tenant.id}):`);
      staffList.forEach(s => {
        console.log(`  - Staff: ${s.name} (${s.email}), Role: ${s.role}, Active: ${s.active}, JoinDate: ${s.joinDate}, ID: ${s.id}`);
        console.log(`    Full staff data:`, JSON.stringify(s, null, 2));
      });
    }
  }

  console.log("\n=== Users Collection ===");
  const usersRef = collection(db, 'users');
  const usersSnap = await getDocs(usersRef);
  const usersList = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  usersList.forEach(u => {
    console.log(`  - User: ${u.userName || u.name || u.displayName} (${u.email || u.loginId}), TenantId: ${u.tenantId}, ID: ${u.id}`);
    console.log(`    Full user data:`, JSON.stringify(u, null, 2));
  });
}

check().catch(console.error);
