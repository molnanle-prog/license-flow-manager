const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-aeca394f-dea5-437b-aec6-d3150ece023f",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'webBridgeTest');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
    console.log("=== Fetching Web Tenants from Firebase Firestore ===");
    try {
        const tenantsRef = collection(db, 'tenants');
        const snapshot = await getDocs(tenantsRef);
        console.log(`Total tenants count: ${snapshot.docs.length}`);
        
        snapshot.docs.forEach((doc, idx) => {
            const data = doc.data();
            console.log(`[Tenant #${idx + 1}]: ID: ${doc.id} | Name: ${data.name} | Plan: ${data.plan} | Owner: ${data.ownerId} | Expires: ${data.licenseExpiresAt || 'N/A'}`);
        });

        console.log("\n=== Fetching Web Users from Firebase Firestore ===");
        const usersRef = collection(db, 'users');
        const userSnapshot = await getDocs(usersRef);
        console.log(`Total users count: ${userSnapshot.docs.length}`);
        userSnapshot.docs.forEach((d, idx) => {
            const data = d.data();
            console.log(`[User #${idx + 1}]: DocID(UID): ${d.id} | Email: ${data.email} | Name: ${data.displayName || data.userName || 'N/A'} | TenantId: ${data.tenantId} | Role: ${data.role}`);
        });

    } catch (e) {
        console.error("Firebase fetch error:", e);
    }
}

run();
