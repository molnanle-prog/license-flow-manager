import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';

const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const app = initializeApp(webAppConfig, 'directTestApp');
const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

async function run() {
    console.log("=== Fetching Tenants directly via Firebase Web SDK ===");
    try {
        const tenantsRef = collection(db, 'tenants');
        // 정렬(orderBy) 없이 단순히 문서를 10개만 읽어와서 인덱스 에러 회피 및 권한 테스트
        const q = query(tenantsRef, limit(20));
        const snapshot = await getDocs(q);
        console.log(`Successfully fetched tenants. Count: ${snapshot.docs.length}`);
        
        snapshot.docs.forEach((doc, idx) => {
            const data = doc.data();
            console.log(`  [Tenant #${idx + 1}]: ID: ${doc.id} | Name: ${data.name} | Plan: ${data.plan} | Owner: ${data.ownerId || data.adminEmail || 'N/A'}`);
        });

    } catch (e) {
        console.error("Tenants direct fetch failed:", e.message || e);
    }

    console.log("\n=== Fetching Users directly via Firebase Web SDK ===");
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, limit(20));
        const snapshot = await getDocs(q);
        console.log(`Successfully fetched users. Count: ${snapshot.docs.length}`);
        
        snapshot.docs.forEach((doc, idx) => {
            const data = doc.data();
            console.log(`  [User #${idx + 1}]: ID: ${doc.id} | Email: ${data.email} | Name: ${data.displayName || data.userName || 'N/A'} | TenantId: ${data.tenantId}`);
        });

    } catch (e) {
        console.error("Users direct fetch failed:", e.message || e);
    }
}

run();
