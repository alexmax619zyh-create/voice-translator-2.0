// Voice Translator HTTP server — zero dependencies
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Find local network IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  // Clean URL path (ignore query strings for static files)
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  let filePath = path.join(ROOT, urlPath);

  // Security: don't serve files outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // If the exact file doesn't exist but it could be a client-side route, serve index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT, 'index.html');
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404 Not Found');
    } else {
      const isStatic = /\.(png|jpg|svg|ico)$/.test(ext);
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': isStatic ? 'max-age=86400' : 'no-cache',
      });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  const localIP = getLocalIP();

  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║    语音翻译助手 已启动          ║');
  console.log('  ║                                ║');
  console.log('  ║  电脑访问:                     ║');
  console.log('  ║  http://localhost:' + PORT + '          ║');

  if (localIP) {
    console.log('  ║                                ║');
    console.log('  ║  手机访问 (同WiFi):           ║');
    console.log('  ║  http://' + localIP + ':' + PORT + '     ║'.padEnd(Math.max(0, 11 - (localIP.length + String(PORT).length)), ' '));
  }

  console.log('  ║                                ║');
  console.log('  ║  手机打开后可安装到桌面 📲    ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('');

  // Auto-open Edge browser
  exec('start msedge http://localhost:' + PORT, { shell: true });
});
