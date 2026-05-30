const { initializeApp } = require('firebase/app');
const { getFirestore, doc, deleteDoc, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'cleanupChuncheonApp');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("=== Cleaning up duplicate tenant 'MxJZVscUEpqfEAgq7CAg' ===");
  try {
    // 1. Delete all docs in staff subcollection
    const staffRef = collection(db, 'tenants/MxJZVscUEpqfEAgq7CAg/staff');
    const staffSnap = await getDocs(staffRef);
    console.log(`Found ${staffSnap.size} staff docs in duplicate tenant.`);
    for (const d of staffSnap.docs) {
      await deleteDoc(doc(db, 'tenants/MxJZVscUEpqfEAgq7CAg/staff', d.id));
      console.log(`- Deleted staff doc: ${d.id}`);
    }

    // 2. Delete tenant document itself
    await deleteDoc(doc(db, 'tenants', 'MxJZVscUEpqfEAgq7CAg'));
    console.log("- Deleted tenant document 'MxJZVscUEpqfEAgq7CAg' successfully!");
  } catch (err) {
    console.error("Cleanup failed:", err);
  }
}

run();
