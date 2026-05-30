const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-aeca394f-dea5-437b-aec6-d3150ece023f",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'checkAppletDb');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("=== Checking Applet Database ===");
  try {
    const tenantsSnap = await getDocs(collection(db, 'tenants'));
    console.log(`Tenants Count: ${tenantsSnap.size}`);
    tenantsSnap.forEach(doc => {
      console.log(`- Tenant Doc: ${doc.id}`, doc.data());
    });

    const usersSnap = await getDocs(collection(db, 'users'));
    console.log(`Users Count: ${usersSnap.size}`);
    usersSnap.forEach(doc => {
      console.log(`- User Doc: ${doc.id}`, doc.data());
    });
  } catch (err) {
    console.error("Error reading from applet db:", err);
  }
}

run();
