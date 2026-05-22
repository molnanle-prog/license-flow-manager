import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
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

// 2. Google Sheets Configuration
const clientEmail = 'license-admin@license-manager-485501.iam.gserviceaccount.com';
const rawPrivateKey = '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----';
const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const sheetId = '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0'; // EzPrintWork Licenses Sheet

async function getAccessToken() {
  const alg = 'RS256';
  const pk = await jose.importPKCS8(privateKey, alg);
  const jwt = await new jose.SignJWT({ scope: SCOPES.join(' ') })
    .setProtectedHeader({ alg })
    .setIssuer(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 30)
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

// 3. Fix Logic
async function fixStaffData() {
  console.log("==================================================");
  console.log("디자이너 이영아 (ya0828) 계정 누락 이메일 보수 작업을 시작합니다.");
  console.log("==================================================");

  const tenantId = 'LXn4O7u7yOUreqzZTtwC'; // 상록인쇄기획
  const userUid = 'lPgo6Jip36r8knzw293C';  // 직접 가입한 이영아 디자이너의 UID
  
  const userRef = doc(webDb, 'users', userUid);
  const staffRef = doc(webDb, `tenants/${tenantId}/staff`, userUid);

  console.log("\n[1단계] Firestore 데이터를 확인하고 보수합니다...");

  // A. 글로벌 users 컬렉션 보수
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    console.log("글로벌 users 문서 발견:", userSnap.data());
    await updateDoc(userRef, {
      email: 'ya0828@ez-hub.kr', // 누락된 이메일 강제 주입
      updatedAt: new Date().toISOString()
    });
    console.log("-> 글로벌 users 이메일 설정 완료: ya0828@ez-hub.kr");
  } else {
    console.warn("글로벌 users 문서가 존재하지 않습니다. 강제 생성합니다.");
    await setDoc(userRef, {
      uid: userUid,
      id: userUid,
      tenantId: tenantId,
      email: 'ya0828@ez-hub.kr',
      loginId: 'ya0828',
      password: '1234',
      userName: '이영아',
      name: '이영아',
      role: 'staff',
      position: '디자이너',
      contactInfo: '010-9992-2354',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log("-> 글로벌 users 문서 신규 복구 완료.");
  }

  // B. 테넌트 staff 서브컬렉션 보수
  const staffSnap = await getDoc(staffRef);
  if (staffSnap.exists()) {
    console.log("테넌트 staff 문서 발견:", staffSnap.data());
    await updateDoc(staffRef, {
      email: 'ya0828@ez-hub.kr', // 이메일 주입
      phone: '010-9992-2354',    // 휴대폰 주입
      phoneCompany: '010-9992-2354' // 회사 휴대폰 주입
    });
    console.log("-> 테넌트 staff 이메일 및 휴대폰 번호 보수 완료!");
  } else {
    console.warn("테넌트 staff 문서가 없습니다. 강제 생성합니다.");
    await setDoc(staffRef, {
      id: userUid,
      uid: userUid,
      name: '이영아',
      role: '디자이너',
      phone: '010-9992-2354',
      phoneCompany: '010-9992-2354',
      active: true,
      email: 'ya0828@ez-hub.kr',
      loginId: 'ya0828',
      password: '1234',
      joinDate: new Date().toISOString()
    });
    console.log("-> 테넌트 staff 문서 신규 복구 완료.");
  }

  // C. 구글 시트 licenses 탭에 이영아 디자이너 라이선스 반영
  console.log("\n[2단계] 구글 시트 라이선스(licenses) 탭 동기화를 수행합니다...");
  
  const token = await getAccessToken();
  const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!readRes.ok) throw new Error(`시트 읽기 실패: ${readRes.statusText}`);
  const sheetData = await readRes.json();
  const rows: any[][] = sheetData.values || [];

  console.log(`구글 시트 로드 성공 (총 ${rows.length}개 행)`);

  // 기존 행 스캔 (ya0828 이 있는지 확인)
  let targetRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const loginId = String(row[1] || '').trim().toLowerCase();
    if (loginId === 'ya0828' || loginId === 'ya0828@ez-hub.kr') {
      targetRowIndex = i;
      break;
    }
  }

  // 구글 시트에 넣을 이영아 디자이너 행 데이터 빌드
  const newRow = [
    'molnanle@gmail.com',         // Admin Email (상록인쇄기획 대표)
    'ya0828',                     // Login ID (또는 ya0828@ez-hub.kr)
    '1234',                       // Password
    '이영아',                     // User Name
    '디자이너',                   // Position
    'MEMBER',                     // Role (일반 직원)
    '상록인쇄기획',               // Company Name
    '',                           // Business Number
    'sangrok01',                  // Company Entry Code
    'u5',                         // Grade/Plan (대표 요금제 상속)
    'PAID',                       // Payment Status
    '',                           // Expiry Date (무제한)
    '010-9992-2354',              // Contact Info
    '',                           // Last Login
    new Date().toISOString()      // Created At
  ];

  if (targetRowIndex >= 0) {
    console.log(`-> 구글 시트 ${targetRowIndex + 1}번째 행에서 기존 정보를 발견하여 보수 갱신합니다.`);
    rows[targetRowIndex] = newRow;
  } else {
    console.log(`-> 구글 시트에 이영아 디자이너 정보가 없어 새로운 행을 하단에 추가합니다.`);
    rows.push(newRow);
  }

  // 구글 시트 덮어쓰기
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!clearRes.ok) throw new Error(`시트 초기화 실패`);

  const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows })
  });
  if (!writeRes.ok) throw new Error(`시트 쓰기 실패`);
  
  console.log("-> 구글 시트 라이선스 탭 동기화 완료!");
  console.log("\n==================================================");
  console.log("이영아 디자이너(ya0828) 계정 보수 및 복구가 완벽히 완료되었습니다!");
  console.log("==================================================");
}

fixStaffData().catch(console.error);
