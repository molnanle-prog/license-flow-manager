const fs = require('fs');
const path = require('path');

async function run() {
    const jose = await import('jose');
    
    // Read credentials from services/storageService.ts
    const storageServiceContent = fs.readFileSync(path.join(__dirname, '../services/storageService.ts'), 'utf8');
    const privateKeyMatch = storageServiceContent.match(/privateKey:\s*'([^']+)'/);
    const clientEmailMatch = storageServiceContent.match(/clientEmail:\s*'([^']+)'/);
    
    if (!privateKeyMatch || !clientEmailMatch) {
        console.error("Could not find credentials in storageService.ts");
        return;
    }
    
    const clientEmail = clientEmailMatch[1];
    const privateKey = privateKeyMatch[1].replace(/\\n/g, '\n').trim();
    
    const SCOPES = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ];

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

    try {
        const token = await getAccessToken();
        const sheetId = "1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ"; // EzImpo

        console.log(`\n=== Dumping EzImpo Licenses ===`);
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Licenses!A:Z`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const rows = data.values || [];
        
        rows.forEach((row, idx) => {
            console.log(`Row ${idx + 1}: ${row.join(' | ')}`);
        });
    } catch (e) {
        console.error("Dump failed:", e);
    }
}

run();
