const fs = require('fs');
const path = require('path');

function searchAndPrintLines(filePath, query) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        if (line.includes(query)) {
            console.log(`${filePath}:${idx + 1}: ${line.trim()}`);
        }
    });
}

searchAndPrintLines(path.join(__dirname, '../components/EzImpoLicenseManager.tsx'), 'e.stopPropagation()');
searchAndPrintLines(path.join(__dirname, '../components/LicenseDelivery.tsx'), 'e.stopPropagation()');
