const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc, getDoc } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'fixDisplayNameApp');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function fix() {
  const userUid = 'lPgo6Jip36r8knzw293C'; // 디자이너 이영아의 UID
  const userRef = doc(db, 'users', userUid);

  console.log("Fetching user document...");
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    console.log("Current user document data:", snap.data());
    await updateDoc(userRef, {
      displayName: "이영아",
      updatedAt: new Date().toISOString()
    });
    console.log("Successfully updated displayName field to '이영아' for user ya0828!");
  } else {
    console.error("User document not found in Firestore users collection.");
  }
}

fix().catch(console.error);
