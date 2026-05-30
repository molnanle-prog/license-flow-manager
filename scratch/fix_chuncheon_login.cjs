const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, deleteDoc, updateDoc } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(firebaseConfig, 'fixChuncheonLogin');
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  const CHUNCHEON_TENANT_ID = 'tenant-or73mu1cz';
  const OLD_USER_ID = 'user-fndeynhwo';
  const REAL_GOOGLE_UID = 'bgxDOm70WrP9icfbhHkzTtF7uwA2';

  console.log("=== Fix Chuncheon Print Admin Login UID ===");

  // 1. Get old user data
  const oldUserDoc = await getDoc(doc(db, 'users', OLD_USER_ID));
  if (!oldUserDoc.exists()) {
    console.error(`Old user document ${OLD_USER_ID} does not exist!`);
    return;
  }
  const oldUserData = oldUserDoc.data();
  console.log("Old User Data:", oldUserData);

  // 2. Get real Google user data if exists
  const realUserDoc = await getDoc(doc(db, 'users', REAL_GOOGLE_UID));
  let realUserData = {};
  if (realUserDoc.exists()) {
    realUserData = realUserDoc.data();
    console.log("Existing Google User Data:", realUserData);
  }

  // 3. Prepare merged user data
  const mergedUserData = {
    ...oldUserData,
    ...realUserData,
    id: REAL_GOOGLE_UID,
    uid: REAL_GOOGLE_UID,
    tenantId: CHUNCHEON_TENANT_ID,
    role: 'admin',
    userName: oldUserData.name || oldUserData.userName || '조성현',
    name: oldUserData.name || oldUserData.userName || '조성현',
    position: oldUserData.position || '대표자',
    updatedAt: new Date().toISOString()
  };

  console.log("Writing merged user data to:", REAL_GOOGLE_UID);
  await setDoc(doc(db, 'users', REAL_GOOGLE_UID), mergedUserData);

  // 4. Update tenant ownerId
  console.log("Updating tenant ownerId to:", REAL_GOOGLE_UID);
  await updateDoc(doc(db, 'tenants', CHUNCHEON_TENANT_ID), {
    ownerId: REAL_GOOGLE_UID,
    updatedAt: new Date().toISOString()
  });

  // 5. Delete old user document
  console.log("Deleting old user document:", OLD_USER_ID);
  await deleteDoc(doc(db, 'users', OLD_USER_ID));

  console.log("=== Fix Completed Successfully! ===");
}

run().catch(console.error);
