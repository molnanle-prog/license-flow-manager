const fs = require('fs');
const path = require('path');

async function run() {
    console.log("==================================================");
    console.log("★ 춘천인쇄 사원 로그인 ID/이메일 정보 정밀 복구 시작 ★");
    console.log("==================================================");

    // Initialize Firebase
    const { initializeApp } = require('firebase/app');
    const { getFirestore, doc, updateDoc } = require('firebase/firestore');
    
    const webAppConfig = {
      projectId: "gen-lang-client-0746903005",
      appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
      apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
      authDomain: "gen-lang-client-0746903005.firebaseapp.com",
      firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
      storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
      messagingSenderId: "19768956246"
    };

    const app = initializeApp(webAppConfig, 'repairEmailsBridge');
    const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

    const CHUNCHEON_TENANT_ID = 'tenant-or73mu1cz'; // 춘천인쇄 테넌트 ID

    // 복구할 사원 정보 매핑
    const staffRepairs = [
        {
            docId: '1780019968175', // 변영지 Staff 문서 ID
            name: '변영지',
            loginId: 'ccp203',
            email: 'ccp203@ez-hub.kr'
        },
        {
            docId: '1780020040463', // 김은경 Staff 문서 ID
            name: '김은경',
            loginId: 'ccp202',
            email: 'ccp202@ez-hub.kr'
        },
        {
            docId: '1780020630255', // 김정호 Staff 문서 ID
            name: '김정호',
            loginId: 'ccp204',
            email: 'ccp204@ez-hub.kr'
        }
    ];

    for (const repair of staffRepairs) {
        const staffDocRef = doc(db, `tenants/${CHUNCHEON_TENANT_ID}/staff`, repair.docId);
        
        await updateDoc(staffDocRef, {
            loginId: repair.loginId,
            email: repair.email,
            phoneCompany: repair.email.split('@')[0] // 로그인 아이디 필드가 간혹 다른 곳에 매핑될 경우 대비
        });
        
        console.log(`-> 사원 [${repair.name}]의 춘천인쇄 staff 문서(${repair.docId})에 로그인 ID [${repair.loginId}] 및 이메일 [${repair.email}] 복구 완료.`);
    }

    console.log("==================================================");
    console.log("★ 춘천인쇄 사원 로그인 ID/이메일 복구 완료! ★");
    console.log("==================================================");
}

run().catch(console.error);
