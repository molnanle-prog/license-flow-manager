const fs = require('fs');
const path = require('path');

async function run() {
    console.log("=== CHECKING GOOGLE DRIVE BACKUPS ===");

    const jose = await import('jose');
    
    // Read Google credentials
    const storageServiceContent = fs.readFileSync(path.join(__dirname, '../services/storageService.ts'), 'utf8');
    const privateKeyMatch = storageServiceContent.match(/privateKey:\s*'([^']+)'/);
    const clientEmailMatch = storageServiceContent.match(/clientEmail:\s*'([^']+)'/);
    
    if (!privateKeyMatch || !clientEmailMatch) {
        console.error("Credentials missing");
        return;
    }
    
    const clientEmail = clientEmailMatch[1];
    const privateKey = privateKeyMatch[1].replace(/\\n/g, '\n').trim();
    const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive'];

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

    const token = await getAccessToken();

    // Query for backups in Google Drive (created by EzPrintWork)
    // Backup folder query or file name search: name contains 'EzPrintWork'
    const url = `https://www.googleapis.com/drive/v3/files?q=name+contains+'EzPrintWork'+and+trashed%3Dfalse&orderBy=createdTime+desc&fields=files(id,name,createdTime,size)`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
        console.error("Failed to list backups:", await res.text());
        return;
    }

    const data = await res.json();
    console.log(`Found ${data.files.length} backup files in Google Drive:`);
    data.files.forEach((f, idx) => {
        console.log(`[${idx}] ID: ${f.id} | Name: ${f.name} | Created: ${f.createdTime} | Size: ${f.size} bytes`);
    });

    // If there is at least one backup, let's download the most recent one and examine the users / staff
    if (data.files.length > 0) {
        const targetFile = data.files[0];
        console.log(`\nDownloading and parsing the most recent backup: ${targetFile.name} (${targetFile.id})...`);
        
        const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!downloadRes.ok) {
            console.error("Download failed:", await downloadRes.text());
            return;
        }

        const backupContent = await downloadRes.json();
        console.log("\n--- BACKUP PARSE SUCCESS ---");
        console.log(`Backup App: ${backupContent.appName} | Version: ${backupContent.version} | Time: ${backupContent.backupTime}`);
        
        console.log("\n[Backup Tenants]:");
        if (backupContent.tenants) {
            backupContent.tenants.forEach(t => console.log(`Tenant ID: ${t.id} | Name: ${t.name} | ownerId: ${t.ownerId}`));
        }

        console.log("\n[Backup Users]:");
        if (backupContent.users) {
            backupContent.users.forEach(u => console.log(`User UID: ${u.uid || u.id} | Name: ${u.name || u.userName} | Email: ${u.email} | tenantId: ${u.tenantId} | role: ${u.role}`));
        }

        console.log("\n[Backup Staff Subcollections]:");
        if (backupContent.tenantSubcollections) {
            Object.keys(backupContent.tenantSubcollections).forEach(tId => {
                const sub = backupContent.tenantSubcollections[tId];
                if (sub && sub.staff && sub.staff.length > 0) {
                    console.log(`Tenant ${tId} staff count: ${sub.staff.length}`);
                    sub.staff.forEach(s => {
                        console.log(`  Staff ID: ${s.id} | Name: ${s.name} | Email: ${s.email} | Role/Position: ${s.role}`);
                    });
                }
            });
        }
    }
}

run().catch(console.error);
