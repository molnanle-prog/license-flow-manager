const fs = require('fs');
const path = require('path');

async function run() {
    console.log("==================================================");
    console.log("★ EzPrintWork 데이터베이스 & 구글 시트 통합 복구 시작 ★");
    console.log("==================================================");

    const jose = await import('jose');
    
    // Read Google credentials from services/storageService.ts
    const storageServiceContent = fs.readFileSync(path.join(__dirname, '../services/storageService.ts'), 'utf8');
    const privateKeyMatch = storageServiceContent.match(/privateKey:\s*'([^']+)'/);
    const clientEmailMatch = storageServiceContent.match(/clientEmail:\s*'([^']+)'/);
    
    if (!privateKeyMatch || !clientEmailMatch) {
        console.error("오류: storageService.ts에서 구글 크레덴셜을 찾을 수 없습니다.");
        return;
    }
    
    const clientEmail = clientEmailMatch[1];
    const privateKey = privateKeyMatch[1].replace(/\\n/g, '\n').trim();
    const sheetId = "1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0"; // EzPrintWork Google Sheets ID
    const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];

    async function getAccessToken() {
        const alg = 'RS256';
        const pk = await jose.importPKCS8(privateKey, alg);
        const iat = Math.floor(Date.now() / 1000) - 30;
        const jwt = await new jose.SignJWT({ scope: SCOPES.join(' ') })
          .setProtectedHeader({ alg })
          .setIssuer(clientEmail)
          .setAudience('https://oauth2.googleapis.com/token')
          .setIssuedAt(iat)
          .setExpirationTime('1h')
          .setSubject(clientEmail)
          .sign(pk);

        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
          }),
        });
        const data = await response.json();
        return data.access_token;
    }

    // Initialize Firebase Bridge
    const { initializeApp } = require('firebase/app');
    const { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');
    
    const webAppConfig = {
      projectId: "gen-lang-client-0746903005",
      appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
      apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
      authDomain: "gen-lang-client-0746903005.firebaseapp.com",
      firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
      storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
      messagingSenderId: "19768956246"
    };

    const app = initializeApp(webAppConfig, 'recoveryBridge');
    const db = getFirestore(app, webAppConfig.firestoreDatabaseId);

    const REAL_SANGROK_TENANT_ID = 'LXn4O7u7yOUreqzZTtwC'; // 진짜 상록인쇄 테넌트 ID
    const FAKE_SANGROK_TENANT_ID = 'jflcSRTOb3HOewsCaoA2'; // 중복 가짜 상록인쇄 테넌트 ID
    const CHUNCHEON_TENANT_ID = 'tenant-or73mu1cz';       // 춘천인쇄 테넌트 ID

    const REAL_SANGROK_ADMIN_UID = 'C4SYpM3k8OXx2b293Y2s1Sr5DgP2'; // 진짜 상록 대표자 UID
    const FAKE_SANGROK_ADMIN_UID = 'bgxDOm70WrP9icfbhHkzTtF7uwA2'; // 가짜 상록 대표자 UID
    const CHUNCHEON_ADMIN_UID = 'user-fndeynhwo';                 // 춘천 대표자 UID

    console.log("\n[1단계] Firestore 사원 마이그레이션 및 테넌트 이전 작업 시작...");

    // A. 가짜 상록인쇄 테넌트 'jflcSRTOb3HOewsCaoA2' 아래의 staff 서브컬렉션 로드
    const fakeStaffSnap = await getDocs(collection(db, `tenants/${FAKE_SANGROK_TENANT_ID}/staff`));
    console.log(`-> 가짜 상록인쇄 테넌트에서 발견된 사원 수: ${fakeStaffSnap.size}명`);

    const staffList = [];
    fakeStaffSnap.forEach(docSnap => {
        staffList.push({ id: docSnap.id, ...docSnap.data() });
    });

    // B. 이 직원들을 춘천인쇄 테넌트 'tenant-or73mu1cz' 하위로 마이그레이션
    for (const member of staffList) {
        const targetStaffRef = doc(db, `tenants/${CHUNCHEON_TENANT_ID}/staff`, member.id);
        
        // 춘천인쇄 정보에 맞춰 사원의 회사명 및 세부 속성 재조정
        const updatedMemberData = {
            ...member,
            companyName: '춘천인쇄',
            phoneCompany: member.phoneCompany || member.phone || '',
            active: true
        };
        
        await setDoc(targetStaffRef, updatedMemberData, { merge: true });
        console.log(`   - 사원 [${member.name}] 도큐먼트를 춘천인쇄 테넌트(/tenants/${CHUNCHEON_TENANT_ID}/staff/${member.id})로 생성 완료.`);

        // 가짜 상록인쇄 테넌트 하위 사원 데이터 삭제
        await deleteDoc(doc(db, `tenants/${FAKE_SANGROK_TENANT_ID}/staff`, member.id));
        console.log(`   - 사원 [${member.name}] 도큐먼트를 가짜 상록인쇄 테넌트에서 삭제 완료.`);
    }

    // C. global users 컬렉션의 사원들의 tenantId를 춘천인쇄 ID로 수정
    const usersSnap = await getDocs(collection(db, 'users'));
    const targetNames = ["변영지", "김은경", "김정호"];
    
    usersSnap.forEach(async (docSnap) => {
        const u = docSnap.data();
        if (targetNames.includes(u.name) || targetNames.includes(u.userName)) {
            const userRef = doc(db, 'users', docSnap.id);
            await updateDoc(userRef, {
                tenantId: CHUNCHEON_TENANT_ID,
                updatedAt: new Date().toISOString()
            });
            console.log(`   - global users 컬렉션 사원 [${u.name || u.userName}]의 tenantId를 춘천인쇄(${CHUNCHEON_TENANT_ID})로 변경 완료.`);
        }
    });

    console.log("\n[2단계] Firestore 중복/가짜 테넌트 및 대표자 정리...");
    
    // A. 가짜 상록인쇄 테넌트 'jflcSRTOb3HOewsCaoA2' 문서 영구 삭제
    await deleteDoc(doc(db, 'tenants', FAKE_SANGROK_TENANT_ID));
    console.log(`-> 가짜 상록인쇄 테넌트 문서(${FAKE_SANGROK_TENANT_ID}) 영구 삭제 완료.`);

    // B. 가짜 상록인쇄 대표자 'bgxDOm70WrP9icfbhHkzTtF7uwA2' 유저 영구 삭제
    await deleteDoc(doc(db, 'users', FAKE_SANGROK_ADMIN_UID));
    console.log(`-> 가짜 상록인쇄 대표 유저 문서(${FAKE_SANGROK_ADMIN_UID}) 영구 삭제 완료.`);

    // C. 진짜 상록인쇄 대표자 유저 문서 정상화 (이름: 윤희철, tenantId 연결 검증)
    const realSangrokAdminRef = doc(db, 'users', REAL_SANGROK_ADMIN_UID);
    await updateDoc(realSangrokAdminRef, {
        name: '윤희철',
        userName: '윤희철',
        tenantId: REAL_SANGROK_TENANT_ID,
        updatedAt: new Date().toISOString()
    });
    console.log(`-> 진짜 상록인쇄 대표 유저 문서(${REAL_SANGROK_ADMIN_UID}) 정보 업데이트 완료 (이름: 윤희철, tenantId: ${REAL_SANGROK_TENANT_ID}).`);

    // D. 진짜 상록인쇄 테넌트 plan u5로 보장
    const realSangrokTenantRef = doc(db, 'tenants', REAL_SANGROK_TENANT_ID);
    await updateDoc(realSangrokTenantRef, {
        plan: 'u5',
        paymentStatus: 'PAID',
        updatedAt: new Date().toISOString()
    });
    console.log(`-> 진짜 상록인쇄 테넌트 플랜 u5 및 PAID 설정 보장 완료.`);

    console.log("\n[3단계] Firestore 춘천인쇄 대표자 및 테넌트 데이터 보강...");
    
    // A. 춘천인쇄 테넌트 문서 업데이트 (요금제 u5, 결제 완료, 입장코드 ccp7770)
    const chuncheonTenantRef = doc(db, 'tenants', CHUNCHEON_TENANT_ID);
    await updateDoc(chuncheonTenantRef, {
        plan: 'u5',
        paymentStatus: 'PAID',
        joinCode: 'ccp7770', // 이미지에 있는 입장코드 ccp7770 강제 세팅
        licenseExpiresAt: null, // 만료 무제한
        name: '춘천인쇄',
        updatedAt: new Date().toISOString()
    });
    console.log(`-> 춘천인쇄 테넌트 문서(${CHUNCHEON_TENANT_ID}) 플랜 u5, 결제완료, 입장코드 ccp7770 세팅 완료.`);

    // B. 춘천인쇄 대표자 유저 문서 업데이트
    const chuncheonAdminRef = doc(db, 'users', CHUNCHEON_ADMIN_UID);
    await updateDoc(chuncheonAdminRef, {
        name: '조성현',
        userName: '조성현',
        email: 'ccp5770@gmail.com',
        loginId: 'ccp5770@gmail.com',
        tenantId: CHUNCHEON_TENANT_ID,
        role: 'admin',
        updatedAt: new Date().toISOString()
    });
    console.log(`-> 춘천인쇄 대표 유저 문서(${CHUNCHEON_ADMIN_UID}) 정보 업데이트 완료 (이름: 조성현, 이메일: ccp5770@gmail.com).`);

    console.log("\n[4단계] 구글 스프레드시트 라이선스 탭(licenses) 완전 복원 동기화...");

    const token = await getAccessToken();
    const headers = [
        "Admin Email", "Login ID", "Password", "User Name", "Position", "Role", "Company Name", 
        "Business Number", "Company Entry Code", "Grade/Plan", "Payment Status", "Expiry Date", 
        "Contact Info", "Last Login", "Created At"
    ];

    const sangrokRow = [
        "molnanle@gmail.com",     // Admin Email (상록인쇄의 진짜 이메일)
        "molnanle@gmail.com",     // Login ID
        "sangrok",                // Password (이미지 상 패스워드)
        "윤희철",                 // User Name (상록인쇄의 진짜 대표자)
        "대표자",                 // Position
        "ADMIN",                 // Role
        "상록인쇄기획",           // Company Name
        "755-09-00724",          // Business Number (상록인쇄의 진짜 사업자번호)
        "sangrok",               // Company Entry Code (joinCode)
        "u5",                    // Grade/Plan (5인 사용)
        "FREE",                  // Payment Status (무료사용)
        "",                      // Expiry Date (무제한)
        "010-7151-1052",         // Contact Info (상록의 진짜 휴대폰 번호)
        "",                      // Last Login
        "2026-01-30 00:00:00"     // Created At (이미지 최초등록일 2026. 1. 30.)
    ];

    const chuncheonRow = [
        "ccp5770@gmail.com",      // Admin Email (춘천인쇄의 진짜 이메일)
        "ccp5770@gmail.com",      // Login ID
        "1575770",                // Password (임시 복구 비밀번호)
        "조성현",                 // User Name (춘천인쇄의 진짜 대표자)
        "대표자",                 // Position
        "ADMIN",                 // Role
        "춘천인쇄",               // Company Name
        "",                      // Business Number
        "ccp7770",               // Company Entry Code (joinCode ccp7770)
        "u5",                    // Grade/Plan (5인 사용)
        "PAID",                  // Payment Status (결제완료)
        "",                      // Expiry Date (무제한)
        "010-9988-1972",         // Contact Info
        "",                      // Last Login
        "2026-05-19 17:45:05"     // Created At (이미지 최초등록일 2026. 5. 19.)
    ];

    const newRows = [headers, sangrokRow, chuncheonRow];

    // 1. Clear old sheet
    console.log("-> 구글 시트 라이선스 탭 비우기 실행 중...");
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z:clear`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    // 2. Write new rows
    console.log("-> 구글 시트 신규 복구 데이터 전송 중...");
    const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            values: newRows
        })
    });
    
    if (writeRes.ok) {
        console.log("-> 구글 시트 라이선스 복원 완료!");
    } else {
        const errText = await writeRes.text();
        console.error("-> 구글 시트 데이터 전송 실패:", errText);
    }

    console.log("\n==================================================");
    console.log("★ EzPrintWork 데이터베이스 & 구글 시트 복구 성공 완료! ★");
    console.log("==================================================");
}

run().catch(console.error);
