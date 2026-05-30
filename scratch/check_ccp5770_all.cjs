const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'checkAllCcp5770');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("Searching Firestore 'users' for email ccp5770@gmail.com...");
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('email', '==', 'ccp5770@gmail.com'));
  const snap = await getDocs(q);
  console.log(`Found ${snap.size} user documents for ccp5770@gmail.com:`);
  snap.forEach(docSnap => {
    console.log(`- Document ID: ${docSnap.id}`);
    console.log(JSON.stringify(docSnap.data(), null, 2));
  });
}

run().catch(console.error);
