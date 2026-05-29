import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("Fetching all tenants...");
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  const tenants = tenantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const targetTenant = tenants.find(t => t.ownerId === 'molnanle@gmail.com' || t.name?.includes('상록인쇄'));
  if (!targetTenant) {
    console.log("Cannot find Sangrok Tenant!");
    return;
  }

  console.log("Sangrok Tenant Found:", targetTenant.id, targetTenant.name);

  console.log("Fetching staff subcollection...");
  const staffSnap = await getDocs(collection(db, `tenants/${targetTenant.id}/staff`));
  const staff = staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log("Sangrok Staffs (Firestore):", JSON.stringify(staff, null, 2));

  console.log("Fetching users collection...");
  const usersSnap = await getDocs(collection(db, 'users'));
  const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log("Users related to Sangrok:", JSON.stringify(users.filter(u => u.tenantId === targetTenant.id || u.email?.includes('srmail90')), null, 2));
}

run().catch(console.error);
