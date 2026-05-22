import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import * as jose from 'jose';

// 1. Firebase Web App Configuration
const webAppConfig = {
  projectId: "gen-lang-client-0746903005",
  appId: "1:19768956246:web:a6cc6b3ca6ffbd53e572f7",
  apiKey: "AIzaSyB04AtEe56eeP40C4cDS7-uvvaPZHa3pkQ",
  authDomain: "gen-lang-client-0746903005.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755",
  storageBucket: "gen-lang-client-0746903005.firebasestorage.app",
  messagingSenderId: "19768956246"
};

const webApp = !getApps().find(app => app.name === 'webBridge') 
  ? initializeApp(webAppConfig, 'webBridge')
  : getApp('webBridge');

const webDb = getFirestore(webApp, webAppConfig.firestoreDatabaseId);

// 2. Google Sheets Credentials and Program Info
const clientEmail = 'license-admin@license-manager-485501.iam.gserviceaccount.com';
const rawPrivateKey = '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----';
const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive'
];

const sheetId = '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0'; // EzPrintWork Licenses Sheet
const TAB_NAME = 'licenses';

// Google API Access Token
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
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return data.access_token;
}

// 3. Main Recovery Logic
async function runRecovery() {
  console.log("==================================================");
  console.log("B2B 춘천인쇄 정상 가입자 (조성현 대표) 복구 작업을 시작합니다.");
  console.log("==================================================");

  const tenantId = 'tenant-or73mu1cz';
  const userUid = 'user-fndeynhwo';

  const tenantRef = doc(webDb, 'tenants', tenantId);
  const userRef = doc(webDb, 'users', userUid);

  // A. Firestore 테넌트 및 유저 상태 확인
  console.log("\n[1단계] Firestore 테넌트 및 유저 데이터 상태를 점검합니다...");
  
  const tenantSnap = await getDoc(tenantRef);
  const userSnap = await getDoc(userRef);

  if (!tenantSnap.exists()) {
    console.error(`오류: 테넌트 ${tenantId}가 존재하지 않습니다.`);
    return;
  }
  if (!userSnap.exists()) {
    console.error(`오류: 대표자 유저 ${userUid}가 존재하지 않습니다.`);
    return;
  }

  const currentTenant = tenantSnap.data();
  const currentUser = userSnap.data();

  console.log("현재 테넌트 정보:", currentTenant);
  console.log("현재 유저 정보:", currentUser);

  // B. Firestore 데이터 정밀 복구 및 업데이트
  console.log("\n[2단계] Firestore 테넌트 및 유저 데이터를 정상 가입 정보로 업데이트합니다...");

  const recoveryTime = new Date().toISOString();

  // 1. 유저 문서 업데이트
  // 이메일과 로그인 ID를 ccp5770@gmail.com으로, 이름 및 닉네임을 조성현 대표로 100% 원복합니다.
  const updatedUserFields = {
    email: 'ccp5770@gmail.com',
    loginId: 'ccp5770@gmail.com',
    name: '조성현',
    userName: '조성현',
    position: '대표자',
    role: 'admin',
    updatedAt: recoveryTime
  };
  await updateDoc(userRef, updatedUserFields);
  console.log("-> 대표자 유저 문서 복구 완료:", updatedUserFields);

  // 2. 테넌트 문서 업데이트
  // 플랜을 5인 요금제인 'u5'로, 결제 상태를 'PAID' (결제완료)로 처리하여 무제한 정상 작동하도록 설정합니다.
  const updatedTenantFields = {
    plan: 'u5',
    paymentStatus: 'PAID',
    licenseExpiresAt: null, // 무제한
    updatedAt: recoveryTime
  };
  await updateDoc(tenantRef, updatedTenantFields);
  console.log("-> 테넌트 문서 복구 완료:", updatedTenantFields);


  // C. Google Sheets 라이선스 탭에 정상 가입 정보 동기화
  console.log("\n[3단계] 구글 스프레드시트 'licenses' 탭에 정상 가입 라이선스를 복구 동기화합니다...");
  
  const token = await getAccessToken();
  
  // 1. 구글 시트에서 전체 라이선스 데이터 읽기
  const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!readRes.ok) {
    throw new Error(`시트 읽기 실패: ${readRes.statusText}`);
  }
  const sheetData = await readRes.json();
  const rows: any[][] = sheetData.values || [];
  
  console.log(`구글 시트 로드 성공 (총 ${rows.length}개 행)`);

  const headers = rows[0] || [
    'Admin Email', 'Login ID', 'Password', 'User Name', 'Position', 'Role', 
    'Company Name', 'Business Number', 'Company Entry Code', 'Grade/Plan', 
    'Payment Status', 'Expiry Date', 'Contact Info', 'Last Login', 'Created At'
  ];

  // 기존 행 정보 중 변조된 임시 가입 정보(user-fndeynhwo@ez-hub.kr) 또는 ccp5770@gmail.com이 있는지 스캔합니다.
  let targetRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const adminEmail = String(row[0] || '').trim().toLowerCase();
    const loginId = String(row[1] || '').trim().toLowerCase();
    
    if (adminEmail === 'ccp5770@gmail.com' || loginId === 'ccp5770@gmail.com' ||
        adminEmail === 'user-fndeynhwo@ez-hub.kr' || loginId === 'user-fndeynhwo@ez-hub.kr') {
      targetRowIndex = i;
      break;
    }
  }

  // 복구할 진짜 행 데이터 배열 빌드
  const newRowData = [
    'ccp5770@gmail.com',                       // Admin Email
    'ccp5770@gmail.com',                       // Login ID
    currentUser.password || 'temp3988',        // Password
    '조성현',                                  // User Name
    '대표자',                                  // Position
    'ADMIN',                                   // Role
    '춘천인쇄',                                // Company Name
    currentTenant.businessNumber || '',        // Business Number
    'ccp5770',                                 // Company Entry Code (joinCode)
    'u5',                                      // Grade/Plan
    'PAID',                                    // Payment Status
    '',                                        // Expiry Date (무제한)
    currentUser.contactInfo || '',             // Contact Info
    currentUser.lastCheckIn || '',             // Last Login
    currentTenant.createdAt || currentUser.createdAt || recoveryTime // Created At
  ];

  if (targetRowIndex >= 0) {
    console.log(`-> 구글 시트 ${targetRowIndex + 1}번째 행에서 기존 잔재/임시 정보를 발견했습니다. 덮어쓰기 복구를 실행합니다.`);
    rows[targetRowIndex] = newRowData;
  } else {
    console.log(`-> 구글 시트에 춘천인쇄 정보가 누락되어 있습니다. 새로운 행을 하단에 추가합니다.`);
    rows.push(newRowData);
  }

  // 2. 구글 시트 업데이트
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z:clear`, {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  if (!clearRes.ok) {
    throw new Error(`시트 전체 비우기 실패: ${clearRes.statusText}`);
  }

  const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: rows })
  });
  if (!writeRes.ok) {
    throw new Error(`시트 쓰기 실패: ${writeRes.statusText}`);
  }
  console.log("-> 구글 시트 라이선스 탭 완벽하게 덮어쓰기 동기화 성공!");

  console.log("\n==================================================");
  console.log("B2B 춘천인쇄 정상 가입자 (조성현 대표, ccp5770@gmail.com) 복구가 완벽히 완료되었습니다!");
  console.log("==================================================");
}

runRecovery().catch(console.error);
