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
        const sheetId = "1vYPhDbmDLOGdckYd2Yd30--d439Qek7wR7k1czrN0g0"; // EzPrintWork

        // Define headers and rows
        const headers = [
            "Admin Email", "Login ID", "Password", "User Name", "Position", "Role", "Company Name", 
            "Business Number", "Company Entry Code", "Grade/Plan", "Payment Status", "Expiry Date", 
            "Contact Info", "Last Login", "Created At"
        ];

        const sangrokRow = [
            "ccp5770@gmail.com",     // Admin Email
            "ccp5770@gmail.com",     // Login ID
            "temp5770",              // Password
            "은희철",                 // User Name
            "대표자",                 // Position
            "ADMIN",                 // Role
            "상록인쇄기획",           // Company Name
            "",                      // Business Number
            "ccp5770",               // Company Entry Code (joinCode)
            "ad",                    // Grade/Plan
            "FREE",                  // Payment Status
            "",                      // Expiry Date
            "010-7151-1052",         // Contact Info (Sangrok's real phone)
            "",                      // Last Login
            "2026-02-20 07:05:00"     // Created At
        ];

        const chuncheonRow = [
            "chuncheon_new@gmail.com", // Admin Email
            "chuncheon_new@gmail.com", // Login ID
            "temp5770",                // Password
            "조성현",                   // User Name
            "대표자",                   // Position
            "ADMIN",                   // Role
            "춘천인쇄",                 // Company Name
            "",                        // Business Number
            "chuncheon",               // Company Entry Code (joinCode)
            "ad",                      // Grade/Plan
            "UNPAID",                  // Payment Status
            "",                        // Expiry Date
            "010-9988-1972",           // Contact Info (Chuncheon's real phone!)
            "",                        // Last Login
            "2026-05-19 17:45:05"      // Created At
        ];

        const newRows = [headers, sangrokRow, chuncheonRow];

        console.log("=== Restoring licenses to Google Sheets ===");
        newRows.forEach((row, idx) => {
            console.log(`Row ${idx + 1}: ${row.join(' | ')}`);
        });

        // 1. Clear old sheet
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/licenses!A:Z:clear`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Sheet cleared.");

        // 2. Write back the updated data
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
        const writeData = await writeRes.json();
        console.log("Write result:", writeData);
        console.log("Successfully restored Sangrok and cleaned up Chuncheon!");

    } catch (e) {
        console.error("Failed to restore and cleanup:", e);
    }
}

run();
