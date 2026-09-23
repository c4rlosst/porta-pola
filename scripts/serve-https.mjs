// Serves this folder over HTTPS on your local network, so a phone can open it and use the camera
// (phone browsers only allow the camera on https or localhost).
//
//   node scripts/serve-https.mjs            # https://<your-pc-ip>:8443
//   PORT=9000 node scripts/serve-https.mjs
//
// A self-signed certificate is created in .certs/ with openssl. Your phone will warn about it once:
// choose "Advanced" / "Show details", then continue to the site.

import https from 'node:https';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const certDir = join(root, '.certs');
const port = Number(process.env.PORT) || 8443;

const lan = Object.values(networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal)
  .map(i => i.address)
  .sort((a, b) => Number(/^(192\.168|10\.)/.test(b)) - Number(/^(192\.168|10\.)/.test(a)));

async function ensureCert() {
  const key = join(certDir, 'key.pem'), cert = join(certDir, 'cert.pem'), stamp = join(certDir, 'ips.txt');
  const ips = lan.join(',');
  if (existsSync(key) && existsSync(cert) && existsSync(stamp) && readFileSync(stamp, 'utf8') === ips) return { key, cert };
  await mkdir(certDir, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lan.map(ip => 'IP:' + ip)].join(',');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', key, '-out', cert, '-subj', '/CN=porta-pola', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
  } catch (e) {
    console.error('Could not run openssl to create a certificate. Install OpenSSL (it ships with Git for Windows) and try again.');
    process.exit(1);
  }
  await writeFile(stamp, ips);
  return { key, cert };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const { key, cert } = await ensureCert();

https.createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
  try {
    const url = new URL(req.url, 'https://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    // only serve the site itself: no dotfiles (.certs, .git) and nothing outside the folder
    if (rel.split('/').some(seg => seg.startsWith('.') && seg !== '')) { res.writeHead(404).end('Not found'); return; }
    const file = resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log('\nPorta-Pola is running. On your phone (same Wi-Fi), open:\n');
  lan.forEach(ip => console.log('  https://' + ip + ':' + port));
  console.log('\nOn this computer:  https://localhost:' + port);
  console.log('\nThe browser will warn about the certificate: choose Advanced, then continue.');
  console.log('Press Ctrl+C to stop.\n');
});
