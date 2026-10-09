// A tiny local server: serves the page and the video files, and receives finished exports.
// Nothing goes to the internet: it listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'exports');
const PORT = Number(process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.onnx': 'application/octet-stream', '.txt': 'text/plain', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    // save a copy of the export into the exports/ folder
    const ext = url.searchParams.get('ext') === 'webm' ? 'webm' : 'mp4';
    fs.mkdirSync(OUT, { recursive: true });
    const name = `speech-figure-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
    const file = path.join(OUT, name);
    const ws = fs.createWriteStream(file);
    req.pipe(ws);
    ws.on('finish', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ file })); });
    ws.on('error', () => { res.writeHead(500); res.end('error'); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range; // needed so that the video can be seeked
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m[1] ? parseInt(m[1]) : 0;
      let end = m[2] ? parseInt(m[2]) : st.size - 1;
      if (!m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2])); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`Port ${PORT} is already in use. The app may already be running: http://localhost:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(`App running: http://localhost:${PORT}\nPress Ctrl+C or close this window to stop.`));
