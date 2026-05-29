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
  const files = walk(webAppPath);
  files.forEach(file => {
    const name = path.basename(file);
    if (name.includes('LoginPage') || name.includes('KanbanBoard') || name.includes('Navbar') || name.includes('Sidebar') || name.includes('AuthContext') || name.includes('App.')) {
      console.log(`FOUND: ${name} -> ${file}`);
    }
  });
}

run();
