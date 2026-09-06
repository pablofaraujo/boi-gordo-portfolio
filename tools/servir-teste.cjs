// Servidor exclusivamente local do build, sem acesso ao Supabase.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '../build');
const tipos = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/boi-gordo-portfolio/, '');
  const arquivo = path.resolve(raiz, `.${caminho.endsWith('/') ? `${caminho}index.html` : caminho}`);
  if (!arquivo.startsWith(`${raiz}/`) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(arquivo).pipe(res);
}).listen(4178, '127.0.0.1');
