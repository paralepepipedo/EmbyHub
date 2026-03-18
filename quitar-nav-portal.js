const fs = require('fs');
let c = fs.readFileSync('public/portal.html', 'utf8');
c = c.replace(/<nav class="mobile-nav">[\s\S]*?<\/nav>/g, '');
fs.writeFileSync('public/portal.html', c, 'utf8');
console.log('OK - nav removida de portal.html');
