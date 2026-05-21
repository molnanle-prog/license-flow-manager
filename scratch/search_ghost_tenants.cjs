const fs = require('fs');
const path = require('path');

function searchDir(dir, query) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                searchDir(fullPath, query);
            }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(query)) {
                console.log(`Found in: ${fullPath}`);
                // Print surrounding lines
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (line.includes(query)) {
                        console.log(`  L${idx + 1}: ${line.trim()}`);
                    }
                });
            }
        }
    }
}

searchDir(path.join(__dirname, '..'), 'ghostTenants');
