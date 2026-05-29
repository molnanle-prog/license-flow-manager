const fs = require('fs');
const path = require('path');

const webAppPath = 'c:\\Users\\CEO\\Desktop\\EzPrintWork(웹)';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git') && !file.includes('dist') && !file.includes('build')) {
        results = results.concat(walk(fullPath));
      }
    } else {
      if (['.js', '.jsx', '.ts', '.tsx'].some(ext => file.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  });
  return results;
}

function run() {
  console.log("Scanning B2B Web App code in:", webAppPath);
  if (!fs.existsSync(webAppPath)) {
    console.error("Cannot find B2B Web App directory!");
    return;
  }

  const files = walk(webAppPath);
  console.log(`Found ${files.length} source files.`);

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      // Look for advertisement visibility or plan conditional check
      if (line.includes('plan') || line.includes('adActive') || line.includes('showAd') || line.includes('Grade') || line.includes('광고')) {
        if (line.includes('===') || line.includes('!==') || line.includes('==') || line.includes('?') || line.includes('if') || line.includes('&&')) {
          console.log(`[${path.basename(file)}:L${idx + 1}]: ${line.trim()}`);
        }
      }
    });
  });
}

run();
