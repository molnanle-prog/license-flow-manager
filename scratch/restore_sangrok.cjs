const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc } = require('firebase/firestore');

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'webBridgeRestore');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
    console.log("=== Restoring '상록인쇄기획' Tenant in Firebase Firestore ===");
    try {
        const tenantId = "jflcSRTOb3HOewsCaoA2";
        const tenantRef = doc(db, 'tenants', tenantId);
        
        const tenantData = {
            name: "상록인쇄기획",
            plan: "pro_plus",
            ownerId: "bgxDOm70WrP9icfbhHkzTtF7uwA2",
            licenseExpiresAt: null,
            createdAt: "2026-01-30T02:12:23.000Z",
            updatedAt: new Date().toISOString(),
            restoredBy: "Antigravity-AI"
        };

        await setDoc(tenantRef, tenantData);
        console.log(`Successfully restored tenant document: ${tenantId}`);
        console.log("Data inserted:", tenantData);
    } catch (e) {
        console.error("Firebase restore error:", e);
    }
}

run();
