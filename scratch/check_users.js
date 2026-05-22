import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'checkApp');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  console.log("Fetching web users...");
  const usersRef = collection(db, 'users');
  const snapshot = await getDocs(usersRef);
  const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`Found ${users.length} users:`);
  users.forEach(u => {
    console.log(`- Email: ${u.email}, Role: ${u.role}, TenantId: ${u.tenantId}, Active: ${u.active}, Name: ${u.userName || u.displayName}`);
    // Print full object for staff to see pending fields
    if (u.role === 'staff' || !u.role) {
      console.log("  Full details:", JSON.stringify(u, null, 2));
    }
  });
}

check().catch(console.error);
