/**
 * Helper HTTP na sessao interativa do usuario (fora do Session 0).
 * Uso: node remote-helper.js --port=17890
 */
'use strict';

const http = require('http');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const PORT = Number(args.port || process.env.NEXAOPS_HELPER_PORT || 17890);
const agentRoot = path.resolve(__dirname, '..');

process.chdir(agentRoot);

const { startCaptureProcess, stopCaptureProcess, getLatestFrameB64 } = require('../lib/screen-share');
const { applyRemoteInput, stopRemoteInputHost } = require('../lib/remote-input');

startCaptureProcess();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hasFrame: !!getLatestFrameB64() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/frame') {
    const data = getLatestFrameB64();
    if (!data) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mime: 'image/jpeg', data }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/input') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      try {
        const ev = JSON.parse(body || '{}');
        await applyRemoteInput(ev.event || ev);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    setTimeout(() => {
      try {
        stopRemoteInputHost();
      } catch (_) {}
      stopCaptureProcess();
      server.close();
      process.exit(0);
    }, 100);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[nexaops-helper] listening 127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => {
  stopCaptureProcess();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopCaptureProcess();
  process.exit(0);
});
