const fs = require('fs');
const path = require('path');

async function run() {
    // We will import firebase-admin or use fetch to Firestore REST API, or we can just import firestore from firebase/firestore which is already installed in node_modules!
    // Wait, let's see how firebaseBridge.ts initializes firestore:
    // It uses standard firebase/app and firebase/firestore.
    // Let's write a script that does the same.
    const { initializeApp } = require('firebase/app');
    const { getFirestore, collection, query, where, getDocs, doc, getDoc } = require('firebase/firestore');

    const webAppConfig = {
      projectId: "gen-lang-client-0746903005",
      appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
      apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
      authDomain: "gen-lang-client-0746903005.firebaseapp.com",
      firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
      storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
      messagingSenderId: "19768956246"
    };

    const app = initializeApp(webAppConfig, 'checkFirebase');
    const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

    try {
        console.log("Searching Firestore for bojakkuna@gmail.com...");
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', 'bojakkuna@gmail.com'));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            console.log("User bojakkuna@gmail.com not found in users collection.");
            return;
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        console.log("User document:", userDoc.id, userData);

        const tenantId = userData.tenantId;
        if (tenantId) {
            console.log(`Searching for tenant with ID: ${tenantId}...`);
            const tenantRef = doc(db, 'tenants', tenantId);
            const tenantSnap = await getDoc(tenantRef);
            if (tenantSnap.exists()) {
                console.log("Tenant document:", tenantSnap.id, tenantSnap.data());
            } else {
                console.log("Tenant document not found.");
            }

            // Also search all users belonging to this tenant
            console.log(`Searching for all users in tenant: ${tenantId}...`);
            const q2 = query(usersRef, where('tenantId', '==', tenantId));
            const snapshot2 = await getDocs(q2);
            console.log(`Found ${snapshot2.docs.length} users:`);
            snapshot2.docs.forEach(d => {
                console.log(`- User ID: ${d.id}, Email: ${d.data().email}, Name: ${d.data().displayName || d.data().userName}`);
            });
        }
    } catch (e) {
        console.error("Error checking Firestore:", e);
    }
}

run();
