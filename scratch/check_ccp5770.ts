import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';

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

async function checkAndRestore() {
  console.log("Checking for user ccp5770@gmail.com...");
  
  // Find User
  const usersRef = collection(webDb, 'users');
  const userQuery = query(usersRef, where('email', '==', 'ccp5770@gmail.com'));
  const userSnap = await getDocs(userQuery);
  
  if (userSnap.empty) {
    console.log("User ccp5770@gmail.com NOT found in Firestore users collection.");
  } else {
    const userDoc = userSnap.docs[0];
    console.log("User found:", userDoc.id, userDoc.data());
    
    // Find Tenant
    const tenantId = userDoc.data().tenantId;
    if (tenantId) {
      const tenantRef = doc(webDb, 'tenants', tenantId);
      const tenantSnap = await getDocs(query(collection(webDb, 'tenants'), where('__name__', '==', tenantId)));
      if (tenantSnap.empty) {
        console.log(`Tenant ${tenantId} NOT found for this user.`);
      } else {
        console.log(`Tenant found:`, tenantSnap.docs[0].id, tenantSnap.docs[0].data());
      }
    }
  }
}

checkAndRestore().catch(console.error);
