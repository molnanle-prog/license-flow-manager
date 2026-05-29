const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'sangrokDetails');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
  const SANGROK_TENANT_ID = 'LXn4O7u7yOUreqzZTtwC';
  const snap = await getDocs(collection(db, `tenants/${SANGROK_TENANT_ID}/staff`));
  
  console.log("=== SANGROK STAFF DETAILS ===");
  snap.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
    console.log("-----------------------------------------");
  });
}

run().catch(console.error);
