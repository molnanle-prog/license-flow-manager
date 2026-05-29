const fs = require('fs');
const path = require('path');

async function run() {
    console.log("=== SCANNING STAFF FIELDS IN FIRESTORE ===");
    
    // Initialize Firebase
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

    const app = initializeApp(webAppConfig, 'checkFieldsBridge');
    const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

    const CHUNCHEON_TENANT_ID = 'tenant-or73mu1cz';
    const SANGROK_TENANT_ID = 'LXn4O7u7yOUreqzZTtwC';

    // 1. Scan Chuncheon Staff
    console.log("\n[Chuncheon Staff Fields Detail]:");
    const chuncheonStaffSnap = await getDocs(collection(db, `tenants/${CHUNCHEON_TENANT_ID}/staff`));
    chuncheonStaffSnap.forEach(docSnap => {
        const s = docSnap.data();
        console.log(`\nName: ${s.name}`);
        Object.keys(s).forEach(key => {
            if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile') || key.toLowerCase().includes('contact') || key.toLowerCase().includes('tel')) {
                console.log(`  - ${key}: "${s[key]}"`);
            }
        });
        // Print all fields just in case
        console.log(`  Full fields:`, JSON.stringify(s));
    });

    // 2. Scan Sangrok Staff
    console.log("\n[Sangrok Staff Fields Detail]:");
    const sangrokStaffSnap = await getDocs(collection(db, `tenants/${SANGROK_TENANT_ID}/staff`));
    sangrokStaffSnap.forEach(docSnap => {
        const s = docSnap.data();
        console.log(`\nName: ${s.name}`);
        Object.keys(s).forEach(key => {
            if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile') || key.toLowerCase().includes('contact') || key.toLowerCase().includes('tel')) {
                console.log(`  - ${key}: "${s[key]}"`);
            }
        });
    });
}

run().catch(console.error);
