const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'chuncheonTenantDetails');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
  const CHUNCHEON_TENANT_ID = 'tenant-or73mu1cz';
  const docRef = doc(db, 'tenants', CHUNCHEON_TENANT_ID);
  const snap = await getDoc(docRef);
  
  console.log("=== CHUNCHEON TENANT FIRESTORE DETAIL ===");
  if (snap.exists()) {
    console.log(JSON.stringify(snap.data(), null, 2));
  } else {
    console.log("Cannot find Chuncheon Tenant document in Firestore!");
  }
}

run().catch(console.error);
