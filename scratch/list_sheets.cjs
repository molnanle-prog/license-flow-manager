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
        const sheetIds = {
            "EzImpo": "1DBSYg8Lqp-Z0o4e35vGsU00XhJeClua-cirsH32xRFQ",
            "EzPrintWork": "1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0"
        };

        for (const [prog, sheetId] of Object.entries(sheetIds)) {
            console.log(`\n=== Sheet details for ${prog} (${sheetId}) ===`);
            const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.sheets) {
                for (const s of data.sheets) {
                    const title = s.properties.title;
                    console.log(`  Tab: ${title}`);
                    // Fetch first 5 rows to see what is inside
                    try {
                        const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'${title}'!A1:Z10`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const valData = await valRes.json();
                        const rows = valData.values || [];
                        console.log(`    Total scanned sample rows: ${rows.length}`);
                        rows.slice(0, 3).forEach((r, i) => {
                            console.log(`      [Row ${i+1}]: ${r.join(' | ')}`);
                        });
                    } catch (e) {
                        console.error(`    Error reading tab ${title}:`, e.message);
                    }
                }
            } else {
                console.log("  No sheets found / Error:", data);
            }
        }
    } catch (e) {
        console.error("Failed to list sheets:", e);
    }
}

run();
