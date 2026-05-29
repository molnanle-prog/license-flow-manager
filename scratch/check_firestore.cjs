const fs = require('fs');
const path = require('path');

async function run() {
    console.log("=== CHECKING FIRESTORE DATA STABILITY ===");
    
    // Dynamic import for jose
    const jose = await import('jose');
    
    // Read credentials from services/storageService.ts or scratch/restore_perfect.cjs
    const storageServiceContent = fs.readFileSync(path.join(__dirname, '../services/storageService.ts'), 'utf8');
    const privateKeyMatch = storageServiceContent.match(/privateKey:\s*'([^']+)'/);
    const clientEmailMatch = storageServiceContent.match(/clientEmail:\s*'([^']+)'/);
    
    if (!privateKeyMatch || !clientEmailMatch) {
        console.error("Could not find credentials");
        return;
    }
    
    // We can import webDb from firebaseBridge by wrapping it in a commonjs require if we setup babel/esm,
    // but it is easier to just initialize a small firebase app directly in this script.
    const { initializeApp } = require('firebase/app');
    const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
    
    const webAppConfig = {
      projectId: "gen-lang-client-0746903005",
      appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
      apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
      authDomain: "gen-lang-client-0746903005.firebaseapp.com",
      firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
      storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
      messagingSenderId: "19768956246"
    };

    const app = initializeApp(webAppConfig, 'checkBridge');
    const db = getFirestore(app, webAppConfig.firestoreDatabaseId);
    
    // 1. Fetch Tenants
    const tenantsSnap = await getDocs(collection(db, 'tenants'));
    console.log(`\n[Tenants Count]: ${tenantsSnap.size}`);
    const tenantsMap = {};
    tenantsSnap.forEach(doc => {
        const data = doc.data();
        tenantsMap[doc.id] = data;
        console.log(`Tenant ID: ${doc.id} | Name: ${data.name} | ownerId: ${data.ownerId} | joinCode: ${data.joinCode} | plan: ${data.plan}`);
    });
    
    // 2. Fetch Users (role === admin or specifically target users)
    const usersSnap = await getDocs(collection(db, 'users'));
    console.log(`\n[Users Count]: ${usersSnap.size}`);
    
    const usersList = [];
    usersSnap.forEach(doc => {
        const data = doc.data();
        usersList.push({ uid: doc.id, ...data });
    });
    
    // Print admins
    console.log("\n[Admin Users]:");
    usersList.filter(u => u.role === 'admin').forEach(u => {
        console.log(`UID: ${u.uid} | Name: ${u.name || u.userName} | Email: ${u.email} | tenantId: ${u.tenantId}`);
    });
    
    // Search for 변영지, 김은경, 김정호
    console.log("\n[Target Staff Check]:");
    const targetNames = ["변영지", "김은경", "김정호"];
    usersList.filter(u => targetNames.includes(u.name) || targetNames.includes(u.userName)).forEach(u => {
        const tName = tenantsMap[u.tenantId]?.name || "UNKNOWN TENANT";
        console.log(`UID: ${u.uid} | Name: ${u.name || u.userName} | Email: ${u.email} | tenantId: ${u.tenantId} (${tName}) | role: ${u.role}`);
    });
    
    // Search in staff subcollections for each tenant
    console.log("\n[Checking subcollections: staff]:");
    for (const tenantId of Object.keys(tenantsMap)) {
        const staffSnap = await getDocs(collection(db, `tenants/${tenantId}/staff`));
        if (staffSnap.size > 0) {
            console.log(`-> Tenant: ${tenantsMap[tenantId].name} (${tenantId}) has ${staffSnap.size} staff members:`);
            staffSnap.forEach(doc => {
                const s = doc.data();
                console.log(`   Staff ID: ${doc.id} | Name: ${s.name} | Email: ${s.email} | Role/Position: ${s.role}`);
            });
        }
    }
}

run().catch(console.error);
