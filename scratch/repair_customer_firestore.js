import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'repairApp');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
    console.log("=== Repairing Firestore Documents ===");
    
    try {
        const tenantRef = doc(db, 'tenants', 'jflcSRTOb3HOewsCaoA2');
        await updateDoc(tenantRef, {
            name: '상록인쇄기획',
            joinCode: 'sangrok',
            updatedAt: new Date().toISOString()
        });
        console.log("Successfully updated tenant jflcSRTOb3HOewsCaoA2 to Sangrok Print!");
    } catch (e) {
        console.error("Failed to update tenant:", e.message || e);
    }

    try {
        const userRef = doc(db, 'users', 'bgxDOm70WrP9icfbhHkzTtF7uwA2');
        await updateDoc(userRef, {
            email: 'molnanle@gmail.com',
            displayName: '은희철',
            userName: '은희철',
            updatedAt: new Date().toISOString()
        });
        console.log("Successfully updated user bgxDOm70WrP9icfbhHkzTtF7uwA2 to molnanle@gmail.com!");
    } catch (e) {
        console.error("Failed to update user:", e.message || e);
    }
}

run();
