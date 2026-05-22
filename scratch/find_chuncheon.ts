import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const webApp = !getApps().find(app => app.name === 'webBridge') 
  ? initializeApp(webAppConfig, 'webBridge')
  : getApp('webBridge');

const webDb = getFirestore(webApp, webAppConfig.firestoreDatabaseId);

async function findChuncheon() {
  console.log("Searching for tenants with name '춘천인쇄'...");
  const tenantsRef = collection(webDb, 'tenants');
  const snap = await getDocs(tenantsRef);
  
  let foundCount = 0;
  snap.forEach(doc => {
    const data = doc.data();
    if (data.name && data.name.includes("춘천인쇄")) {
      console.log("Found Tenant:", doc.id, data);
      foundCount++;
    }
  });
  
  if (foundCount === 0) {
    console.log("No '춘천인쇄' tenants found.");
  }
}

findChuncheon().catch(console.error);
