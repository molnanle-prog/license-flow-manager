const jose = require('jose');

const clientEmail = 'license-admin@license-manager-485501.iam.gserviceaccount.com';
const privateKey = `-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----`;

const sheetId = '1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ'; // EzImpo Sheet ID

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets'
];

async function getAccessToken() {
    const alg = 'RS256';
    let cleanKey = privateKey.replace(/\\n/g, '\n').trim();
    const pemHeaderRegex = /-----BEGIN [A-Z ]+-----/;
    const pemFooterRegex = /-----END [A-Z ]+-----/;
    const headerMatch = cleanKey.match(pemHeaderRegex);
    const footerMatch = cleanKey.match(pemFooterRegex);
    let body = cleanKey;
    if (headerMatch && footerMatch) {
        const headerIdx = headerMatch.index + headerMatch[0].length;
        const footerIdx = footerMatch.index;
        if (footerIdx > headerIdx) body = cleanKey.substring(headerIdx, footerIdx);
    }
    body = body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (body.length % 4 !== 0) body += '=';
    
    const finalPem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
    const pk = await jose.importPKCS8(finalPem, alg);
    const iat = Math.floor(Date.now() / 1000) - 30;
    const jwt = await new jose.SignJWT({ scope: SCOPES.join(' ') })
      .setProtectedHeader({ alg })
      .setIssuer(clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(iat)
      .setExpirationTime('1h')
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

async function readSheetData(range) {
    const token = await getAccessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    return data.values || [];
}

async function main() {
    try {
        console.log("시트 데이터 읽는 중...");
        const licensesRows = await readSheetData('Licenses!A:Z');
        const installLogsRows = await readSheetData('InstallLogs!A:Z');
        
        console.log(`Licenses 행 수: ${licensesRows.length}`);
        console.log(`InstallLogs 행 수: ${installLogsRows.length}`);
        
        // 이미지의 15명 고객 정보와 매칭되는지 확인하기 위한 리스트
        const targetKeys = [
            'EZIM-MRTL-2S8S-1T7L',
            'EZIM-L3QN-23RD-NTGS',
            'EZIM-QD8Y-D3SV-1Y1E',
            'EZIM-21YX-L46S-Q2SG',
            'EZIM-78RF-Q9SH-YFLK',
            'EZIM-V1Xy-UEH8-UJY4',
            'EZIM-GK7Q-V8SZ-VFKV', // 'EZIM-GK7Q-V8SZ-VFKV' 로 추정되나 확인 필요
            'EZIM-QKCE-WBMD-B8GB',
            'EZIM-PF4S-TTTN-8UMY',
            'EZIM-KJ5N-V8QK-JT9R',
            'EZIM-TPQN-UXSC-KTRU',
            'EZIM-RU6Y-YF19-8LJB',
            'EZIM-6T3U-281Q-05LD',
            'EZIM-1V6D-7T6L-8PYG',
            'EZIM-43ND-N3XF-XXV7'
        ].map(k => k.toUpperCase().replace(/[^A-Z0-9]/g, ''));

        // Licenses 파싱
        const licHeaders = licensesRows[0];
        const licenses = licensesRows.slice(1).map(row => {
            const obj = {};
            licHeaders.forEach((h, i) => {
                obj[h] = row[i];
            });
            return obj;
        });

        // InstallLogs 파싱
        const logHeaders = installLogsRows[0];
        const logs = installLogsRows.slice(1).map(row => {
            const obj = {};
            logHeaders.forEach((h, i) => {
                obj[h] = row[i];
            });
            return obj;
        });

        console.log("\n=== 대상 15명 분석 ===");
        const results = [];
        let testLicenseMatches = 0;

        licenses.forEach(l => {
            const keyNorm = String(l['License Key'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            // 15명 키 매칭 (EZIM 부분 매칭 포함)
            const isTarget = targetKeys.some(tk => keyNorm.includes(tk) || tk.includes(keyNorm));
            
            if (isTarget) {
                const name = l['Name / Position'] || '';
                const company = l['Company Name'] || '';
                const contact = l['Contact Info'] || '';
                const key = l['License Key'] || '';
                const mid = l['Machine ID'] || '';
                
                // 이 사용자의 InstallLogs 중 MachineID가 'TEST' 이거나, 과거 액션에 'TEST'가 섞여 있는지 탐색
                const userLogs = logs.filter(log => {
                    const lContact = String(log['Contact'] || '').replace(/[^0-9]/g, '');
                    const tContact = String(contact).replace(/[^0-9]/g, '');
                    const lName = String(log['UserName'] || '').trim();
                    const tName = String(name).trim();
                    
                    // 연락처가 있고 연락처가 같거나, 이름이 같고 회사가 같은 경우
                    if (tContact && lContact === tContact) return true;
                    if (tName && lName === tName) return true;
                    return false;
                });

                const testLogCount = userLogs.filter(log => {
                    const mId = String(log['MachineID'] || '').toUpperCase();
                    return mId.includes('TEST');
                }).length;
                
                const hasTestLog = testLogCount > 0;
                if (hasTestLog) testLicenseMatches++;

                results.push({
                    key,
                    name,
                    company,
                    contact,
                    machineId: mid,
                    hasTestLog,
                    testLogCount,
                    totalLogs: userLogs.length,
                    testLogsDetails: userLogs.filter(log => String(log['MachineID'] || '').toUpperCase().includes('TEST')).map(log => ({
                        time: log['Timestamp'],
                        mid: log['MachineID'],
                        action: log['ActionType'] || log['Action']
                    }))
                });
            }
        });

        console.log(`매칭된 타겟 라이선스 개수: ${results.length}`);
        console.log(`과거 'TEST' 기기 ID 로그 흔적이 있는 사람: ${testLicenseMatches}명`);
        
        results.forEach((r, idx) => {
            console.log(`\n[${idx + 1}] ${r.name} (${r.company})`);
            console.log(`   키: ${r.key}`);
            console.log(`   현재 기기ID: ${r.machineId}`);
            console.log(`   총 로그 수: ${r.totalLogs}, TEST 로그 수: ${r.testLogCount}`);
            if (r.hasTestLog) {
                console.log(`   -> TEST 흔적 있음!`);
                r.testLogsDetails.slice(0, 2).forEach(d => {
                    console.log(`      * [${d.time}] 기기ID: ${d.mid}, 동작: ${d.action}`);
                });
            } else {
                console.log(`   -> TEST 흔적 없음`);
            }
        });

        console.log("\n=== InstallLogs 전체에서 MachineID가 'TEST'인 고유 사용자 분석 ===");
        const testLogs = logs.filter(log => String(log['MachineID'] || '').toUpperCase() === 'TEST');
        const uniqueTestUsers = {};
        testLogs.forEach(log => {
            const name = String(log['UserName'] || '').trim();
            const contact = String(log['Contact'] || '').replace(/[^0-9]/g, '');
            const company = String(log['CompanyName'] || '').trim();
            const key = `${name}_${contact}`;
            if (!uniqueTestUsers[key]) {
                uniqueTestUsers[key] = { name, contact, company, count: 0, firstSeen: log['Timestamp'], lastSeen: log['Timestamp'] };
            }
            uniqueTestUsers[key].count++;
            uniqueTestUsers[key].lastSeen = log['Timestamp'];
        });

        console.log(`과거 기기 ID 'TEST'로 접속한 고유 사용자 수: ${Object.keys(uniqueTestUsers).length}명`);
        Object.values(uniqueTestUsers).forEach((u, i) => {
            // 이 사용자가 현재 Licenses 에 어떤 키로 매칭되어 있는지 탐색
            const licMatch = licenses.find(l => {
                const lName = String(l['Name / Position'] || '').trim();
                const lContact = String(l['Contact Info'] || '').replace(/[^0-9]/g, '');
                return lName === u.name || (lContact && lContact === u.contact);
            });
            console.log(`[${i+1}] ${u.name} (상호: ${u.company}, 연락처: ${u.contact}) -> ${u.count}회 접속`);
            if (licMatch) {
                console.log(`    현재 라이선스: ${licMatch['License Key']} (${licMatch['Payment']} / ${licMatch['Status']})`);
            } else {
                console.log(`    현재 라이선스: 없음`);
            }
        });

    } catch (e) {
        console.error("오류 발생:", e);
    }
}

main();
