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
        'https://www.googleapis.com/auth/datastore', // Firestore scope
        'https://www.googleapis.com/auth/cloud-platform'
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
        const projectId = "gen-lang-client-0746903005";
        const databaseId = "ai-studio-9c19ea8d-a769-47dc-b3b1-5cc0b25fe755";
        
        const collections = ["tenants", "users"];
        
        for (const col of collections) {
            console.log(`\n=== Fetching from Firestore [${databaseId}]: ${col} ===`);
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${col}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            
            if (data.documents) {
                console.log(`Total documents found in ${col}: ${data.documents.length}`);
                data.documents.forEach((doc, idx) => {
                    const fields = doc.fields || {};
                    const formattedFields = {};
                    for (const [key, value] of Object.entries(fields)) {
                        formattedFields[key] = value.stringValue || value.integerValue || value.booleanValue || JSON.stringify(value);
                    }
                    console.log(`  [Doc #${idx + 1}]: Name: ${doc.name.split('/').pop()} | Data:`, JSON.stringify(formattedFields));
                });
            } else {
                console.log(`  No documents found or error in ${col}:`, JSON.stringify(data));
            }
        }
        
    } catch (e) {
        console.error("Firestore REST failed:", e);
    }
}

run();
