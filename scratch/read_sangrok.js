const jose = require('jose');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets'
];

const DEFAULT_CONFIG = {
  clientEmail: 'license-admin@license-manager-485501.iam.gserviceaccount.com', 
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY\npEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP\nmhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY\nu3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx\nkkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ\nmDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK\nK79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk\n+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX\nx7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq\nM9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT\npWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1\nRy5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ\nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6\nxdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja\nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2\n7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5\nolZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ\ngpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT\nfr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k\nauoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz\n0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j\nI6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak\ngLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy\n+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7\nWk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7\n8djSsvpGLVUlkmFiUSg+AK2bYg==\n-----END PRIVATE KEY-----', 
  sheetId: '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0'
};

const getAccessToken = async (clientEmail, privateKey) => {
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
  } else {
      body = body.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '');
  }
  body = body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (body.length % 4 !== 0) body += '=';
  const finalPem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  const pk = await jose.importPKCS8(finalPem, 'RS256');
  const iat = Math.floor(Date.now() / 1000) - 30;
  const jwt = await new jose.SignJWT({ scope: SCOPES.join(' ') })
    .setProtectedHeader({ alg: 'RS256' })
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
  if (data.error) throw new Error(data.error_description || data.error);
  return data.access_token;
};

const main = async () => {
  try {
    const token = await getAccessToken(DEFAULT_CONFIG.clientEmail, DEFAULT_CONFIG.privateKey);
    const range = "'licenses'!A:Z";
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_CONFIG.sheetId}/values/${encodeURIComponent(range)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    const rows = data.values || [];
    
    console.log("=== 상록인쇄기획 검색 결과 ===");
    let found = false;
    rows.forEach((row, idx) => {
      const rowStr = JSON.stringify(row);
      if (rowStr.includes("상록")) {
        console.log(`[Row ${idx + 1}]`, row);
        found = true;
      }
    });
    if (!found) {
      console.log("구글 시트에서 '상록'이 들어간 라이선스를 찾을 수 없습니다.");
    }
  } catch (err) {
    console.error("오류 발생:", err);
  }
};

main();
