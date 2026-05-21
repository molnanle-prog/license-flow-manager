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

const app = initializeApp(webAppConfig, 'webBridgeTestFields');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
    console.log("=== Fetching Raw Web Tenants & Users ===");
    try {
        const tenantsRef = collection(db, 'tenants');
        const snapshot = await getDocs(tenantsRef);
        snapshot.docs.forEach((doc) => {
            console.log(`\nTenant ID: ${doc.id}`);
            console.log("Raw Fields:", JSON.stringify(doc.data(), null, 2));
        });

        const usersRef = collection(db, 'users');
        const userSnapshot = await getDocs(usersRef);
        userSnapshot.docs.forEach((doc) => {
            console.log(`\nUser ID: ${doc.id}`);
            console.log("Raw Fields:", JSON.stringify(doc.data(), null, 2));
        });
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
