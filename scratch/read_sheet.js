import * as jose from 'jose';

const clientEmail = 'license-admin@license-manager-485501.iam.gserviceaccount.com';
const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCs5q0s0mUxZSkY
pEqYG5L5+ZwvBAorF7xhTArmjbQYMxGTJgShzjXKzAFXE85YcjZg1JWEv4JgwsSP
mhLrPnGovKZEqg9F0nN3nBfonzufYKvdd/vvogvgkCFUAY4ZT9/FKgxa75vof9KY
u3WWWM86CfEwlAhC2h/h/VEfrLx8sxutIU7CLHHNDYXbSdAxhFSEFTlBhRtBbjRx
kkaTCarFy2vAnF4uMYXH84fjpG+5Uun3BJXrIbofgfw+KlaTceLq8tMg5tIPHflQ
mDtIL12uvLVC/oZWcpNnyjvuBFAYLN7r4itLDY2hovOMwHJkhcGNTN+U74ozRgtK
K79HbwybAgMBAAECggEAAkeIQO8FJoGO6SRBV4AFkAYaaQREngzSDvZRrnhvx2Hk
+Wum4/sz+lh2LA+2yLO4w84JqpZbwarPrJT7at6H4RGbn4weZ20+2HTWW9q9jnxX
x7OtPpuETJGZ3uGmXe8PpCnJv+koxQfqXtkZ08GX+cvnwhwxf7Age3o7d49vbLVq
M9RjODd0k/RMFVewAEwX9PAYlCUOA8zeUptOTqbDl9/kWHQ2ZNl3WjI9CRzcZZpT
pWXAinYrpHNxpXeejYfbHJaZQz/Gwirt0CGScQ1rV8WqKpwjUAjr4H5Iat5U0YQ1
Ry5ZIbraaKkA/MYYEKD0bDcVdmoRNKKjlNrjeeOzAQKBgQDqA49uKH0QYQ6+/cRZ
nP+YI3id/Su/YJj00Md8tBkiejek80djp37f2X/nAsF1OiweDZsSAzlZTy7Sandp6
xdWm6K5svlu6PfGF4pZjIQBog3jP+Wpywev/cbqfxxjad8qPloardrJkC/X+Uwja
nr2b2dp+nFmXnR2HTHWM+99RcxwKBgQC9JT8yMvdxARG6hxIagP9nyXfxmHgthQD2
7EENHjbmshwxM1bCNtAE1ulpw076hmBdKej9WG+EXY3x8uZfBJmseEdoNTLLY6L5
olZqVqHNtHK6ihSxKJrAlDxgjTdncwr2oCKEjBB0ZUHNlm8MO+3joX1Q8HRqasCZ
gpHic2d1jQKBgQClxE/d4KB28cnYUTq9Xh49OeEQsqyjmLLSPmGxKzpV1oDZrGzT
fr55sBLjBAuUj7eKxUl9VKyiPzJ4NEmHnoxx53FnZpDjpO1pwdB19/KqFjeGW0+k
auoZ0R46AHcCisjaXe6Xl0VWyYI/3eHvx0BQZkdBvQQCiPYq7i5XdIbiEQKBgQCz
0syRSjlLu2uCfdXtUsT/hGA/VeizxiaTmyuBcD9b9uusrxWF0ZzVbQk+nwvgTI8j
I6w56LElE9jWtUrl/Tao7TVeUm13RsP0N62WrcRpEGyfApYHlAYEnyoD1V5eQNak
gLwwbgVa08XK0oHDDNrvNmIw6FqVreZsS+GsfHFZJQKBgQDkVpBjj1rzA2YJu3Wy
+V2rUY9SzH/H7isWTPXzxZi+AJEqXQjFWLPzM4yETS9PcvpPoMAFXBdnAh9Nspm7
Wk8+zQPlqpNguHbgKVjwXziU0IDpse+mq6dJAmggnf/V7VPK8MSQGe7SfWmg4ct7
8djSsvpGLVUlkmFiUSg+AK2bYg==
-----END PRIVATE KEY-----`;

const sheetId = '1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0';

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
  } else {
      body = body.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '');
  }
  body = body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (body.length % 4 !== 0) body += '=';
  const finalPem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  const pk = await jose.importPKCS8(finalPem, alg);
  const iat = Math.floor(Date.now() / 1000) - 30;
  const jwt = await new jose.SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets' })
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

async function run() {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log("=== Headers ===");
    console.log(data.values ? data.values[0] : "No data");
    console.log("=== Rows ===");
    if (data.values) {
      data.values.slice(1).forEach((row, i) => {
        console.log(`[Row ${i+2}]`, row);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

run();
