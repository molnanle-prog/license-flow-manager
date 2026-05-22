import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

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

async function findUserByUid() {
  console.log("Searching for user with UID 'user-fndeynhwo'...");
  const userRef = doc(webDb, 'users', 'user-fndeynhwo');
  const snap = await getDoc(userRef);
  
  if (snap.exists()) {
    console.log("Found User by UID:", snap.id, snap.data());
  } else {
    console.log("User 'user-fndeynhwo' NOT found.");
  }
}

findUserByUid().catch(console.error);
