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

const app = initializeApp(firebaseConfig, 'simulateFuseApp');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("Simulating getPrintWorkLicenses Firestore Master load...");
  
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  const tenants = tenantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const usersSnap = await getDocs(collection(db, 'users'));
  const users = usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

  console.log(`Loaded ${tenants.length} tenants and ${users.length} users.`);

  const tenantMap = new Map(tenants.map(t => [t.id, t]));

  const adminLicenses = users
    .filter(u => u.role === 'admin' || tenants.some(t => t.ownerId === u.uid))
    .map(u => {
      const tenant = u.tenantId ? tenantMap.get(u.tenantId) : null;
      const planVal = tenant ? tenant.plan : 'free';
      const paymentStatusVal = tenant ? tenant.paymentStatus || 'UNPAID' : 'UNPAID';
      
      const isApprovedInFirestore = (u.role === 'admin' || tenants.some(t => t.ownerId === u.uid)) && (paymentStatusVal === 'PAID' || paymentStatusVal === 'FREE');
      const isWebOnlyVal = !isApprovedInFirestore;

      return {
        email: u.email,
        name: u.name || u.userName,
        role: u.role,
        tenantId: u.tenantId,
        plan: planVal,
        paymentStatus: paymentStatusVal,
        isApprovedInFirestore,
        isWebOnlyVal
      };
    });

  console.log("Mapped adminLicenses:");
  console.log(JSON.stringify(adminLicenses, null, 2));
}

run().catch(console.error);
