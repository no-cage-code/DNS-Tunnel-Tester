'use strict';
const { spawn, execSync } = require('child_process');
const net  = require('net');
const http = require('http');
const fs   = require('fs');
const path = require('path');

// ─── Kill any leftover dnstt-client processes from previous runs ──────────────
try { execSync('pkill -x dnstt-client', { stdio: 'ignore' }); } catch {}


// ─── Defaults ─────────────────────────────────────────────────────────────────
let cfg = {};
try { cfg = require('./config.js'); } catch {}

let   DNSTT_CLIENT_PATH     = process.env.DNSTT_CLIENT || '';
const DEFAULT_PUBKEY        = process.env.DNSTT_PUBKEY  || cfg.PUBKEY        || '';
const DEFAULT_TUNNEL_DOMAIN = process.env.DNSTT_DOMAIN  || cfg.TUNNEL_DOMAIN || '';
const BASE_SOCKS_PORT       = 1080;
const SERVER_PORT           = 3738;

// ─── Wait until a local TCP port is FREE (no one listening) ──────────────────
function waitForPortFree(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt  = () => {
      const sock = new net.Socket();
      let settled = false;
      const fin = free => {
        if (settled) return; settled = true;
        sock.destroy();
        if (free) {
          resolve();
        } else if (Date.now() < deadline) {
          setTimeout(attempt, 300);
        } else {
          reject(new Error(`port_${port}_still_busy`));
        }
      };
      sock.setTimeout(300);
      sock.once('connect', () => fin(false)); // پورت گرفته‌شده → آزاد نیست
      sock.once('error',   () => fin(true));  // connection refused → آزاده
      sock.once('timeout', () => fin(true));  // timeout → کسی listen نمی‌کنه
      sock.connect(port, '127.0.0.1');
    };
    attempt();
  });
}

// ─── Wait until a local TCP port is listening ─────────────────────────────────
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt  = () => {
      const sock = new net.Socket();
      let settled = false;
      const fin = ok => {
        if (settled) return; settled = true;
        sock.destroy();
        if (ok) {
          resolve();
        } else if (Date.now() < deadline) {
          setTimeout(attempt, 400);
        } else {
          reject(new Error('socks5_not_ready'));
        }
      };
      sock.setTimeout(400);
      sock.once('connect', () => fin(true));
      sock.once('error',   () => fin(false));
      sock.once('timeout', () => fin(false));
      sock.connect(port, '127.0.0.1');
    };
    attempt();
  });
}

// ─── SOCKS5 CONNECT test ──────────────────────────────────────────────────────
// هر پاسخ معتبر SOCKS5 (هر REP) = tunnel کار می‌کند
// از IP مستقیم استفاده می‌کنیم تا DNS روی VPS مشکل نداشته باشد
// 1.1.1.1:80 — اگر بسته باشه REP≠0 می‌دهد، که باز هم یعنی تانل زنده است
function testViaSocks5(port, timeoutMs) {
  // ATYP=IPv4, target: 1.1.1.1:80
  const TARGET_IP   = [1, 1, 1, 1];
  const TARGET_PORT = 80;

  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false, stage = 0, buf = Buffer.alloc(0);

    const fin = (ok, err) => {
      if (settled) return; settled = true;
      sock.destroy();
      if (ok) resolve();
      else reject(new Error(err || 'socks5_failed'));
    };

    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => fin(false, 'timeout'));
    sock.once('error', e  => fin(false, e.code || e.message));

    sock.connect(port, '127.0.0.1', () => {
      // VER=5, NMETHODS=1, METHOD=0 (no‑auth)
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);

      if (stage === 0 && buf.length >= 2) {
        if (buf[0] !== 0x05 || buf[1] !== 0x00) {
          fin(false, 'socks5_auth_rejected'); return;
        }
        stage = 1;
        buf = buf.slice(2);

        // CONNECT request: VER=5 CMD=CONNECT RSV ATYP=IPv4 [4 bytes IP] [2 bytes PORT]
        const req = Buffer.alloc(10);
        req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01;
        req[4] = TARGET_IP[0]; req[5] = TARGET_IP[1];
        req[6] = TARGET_IP[2]; req[7] = TARGET_IP[3];
        req.writeUInt16BE(TARGET_PORT, 8);
        sock.write(req);
      }

      // هر پاسخ ≥4 بایت معتبر SOCKS5 = تانل زنده است (REP هر چیزی باشه)
      if (stage === 1 && buf.length >= 4) {
        if (buf[0] === 0x05) fin(true, null);
        else fin(false, `invalid_socks5_reply_${buf[0]}`);
      }
    });
  });
}

// ─── Test one IP with one protocol ───────────────────────────────────────────
async function testOne(ip, protocol, socksPort, opts) {
  const { dnsttPath, pubkey, tunnelDomain, stealth, startupMs, testMs, state, log } = opts;
  const t0 = Date.now();

  // اگه IP به صورت 1.2.3.4:53 باشه، پورت رو جدا می‌کنیم
  const resolverIP = ip.includes(':') ? ip.split(':')[0] : ip;
  const resolverAddr = `${resolverIP}:53`;

  // noizdns requires -noiz flag which the standard dnstt-client binary does not support
  if (protocol === 'noizdns') {
    log(`[noizdns] ${resolverIP} → SKIP: binary does not support -noiz flag`);
    return { ip: resolverIP, protocol, status: 'skip', latency_ms: -1, error: 'binary_no_noiz_support' };
  }

  const args = ['-udp', resolverAddr, '-pubkey', pubkey];
  args.push(tunnelDomain, `127.0.0.1:${socksPort}`);

  log(`[${protocol}] ${resolverIP} → waiting for port ${socksPort} to be free…`);
  try { await waitForPortFree(socksPort, 3000); } catch (e) { log(`[${protocol}] ${resolverIP} ⚠️ ${e.message}, proceeding anyway`); }

  log(`[${protocol}] ${resolverIP} → spawn: ${dnsttPath} ${args.join(' ')}`);

  let proc = null;
  try {
    proc = spawn(dnsttPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    // لاگ stderr از dnstt-client
    let stderrBuf = '';
    proc.stderr.on('data', d => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(l => { if (l.trim()) log(`[${protocol}] ${resolverIP} stderr: ${l.trim()}`); });
    });

    proc.on('error', e => log(`[${protocol}] ${resolverIP} spawn error: ${e.message}`));
    proc.on('exit',  c => log(`[${protocol}] ${resolverIP} process exited: ${c}`));

    if (state) state.procs.add(proc);

    log(`[${protocol}] ${resolverIP} → waiting for SOCKS5 on port ${socksPort} (max ${startupMs}ms)`);
    await waitForPort(socksPort, startupMs);
    log(`[${protocol}] ${resolverIP} → SOCKS5 port ${socksPort} is UP ✓`);

    if (state && state.aborted) throw new Error('aborted');

    log(`[${protocol}] ${resolverIP} → testing SOCKS5 connect to www.google.com:80`);
    await testViaSocks5(socksPort, testMs);

    const latency = Date.now() - t0;
    log(`[${protocol}] ${resolverIP} → PASS ✅ (${latency}ms)`);
    return { ip: resolverIP, protocol, status: 'pass', latency_ms: latency, error: '' };
  } catch (err) {
    log(`[${protocol}] ${resolverIP} → FAIL ❌ (${err.message})`);
    return { ip: resolverIP, protocol, status: 'fail', latency_ms: -1, error: err.message };
  } finally {
    if (proc) {
      if (state) state.procs.delete(proc);
      try { proc.kill('SIGKILL'); } catch {}
    }
    // کمی صبر تا OS پورت رو آزاد کنه
    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── Scan state ───────────────────────────────────────────────────────────────
let scanState = null;

// ─── HTTP Server ──────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${SERVER_PORT}`);

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Serve tunnel-tester.html ──────────────────────────────────────────────
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/tunnel-tester.html')) {
    const htmlPath = path.join(__dirname, 'tunnel-tester.html');
    try {
      const html = fs.readFileSync(htmlPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404); res.end('tunnel-tester.html not found');
    }
    return;
  }

  // ── Ping ──────────────────────────────────────────────────────────────────
  if (url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      dnsttSet:     !!DNSTT_CLIENT_PATH,
      pubkey:       DEFAULT_PUBKEY,
      tunnelDomain: DEFAULT_TUNNEL_DOMAIN,
    }));
    return;
  }

  // ── Stop ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/stop') {
    if (scanState) {
      scanState.aborted = true;
      for (const p of scanState.procs) { try { p.kill('SIGKILL'); } catch {} }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Start test ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/test') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const {
          ips,
          mode          = 'both',        // 'dnstt' | 'noizdns' | 'both'
          dnsttPath     = DNSTT_CLIENT_PATH,
          pubkey        = DEFAULT_PUBKEY,
          tunnelDomain  = DEFAULT_TUNNEL_DOMAIN,
          stealth       = false,
          concurrency   = 5,
          startupMs     = 5000,
          testMs        = 25000,
        } = JSON.parse(body);

        if (!ips || !ips.length)           throw new Error('لیست IP خالی است');
        if (!dnsttPath)                    throw new Error('مسیر dnstt-client تنظیم نشده');

        // Build work queue
        const work = [];
        for (const ip of ips) {
          const trimmed = ip.trim().split(':')[0]; // strip :53 if present
          if (!trimmed || !/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) continue;
          if (mode === 'both') {
            work.push({ ip: trimmed, protocol: 'dnstt'    });
            work.push({ ip: trimmed, protocol: 'noizdns'  });
          } else {
            work.push({ ip: trimmed, protocol: mode });
          }
        }
        if (!work.length) throw new Error('هیچ IP معتبری یافت نشد');

        // Port pool: BASE_SOCKS_PORT … BASE_SOCKS_PORT + concurrency - 1
        const ports = Array.from({ length: concurrency }, (_, i) => BASE_SOCKS_PORT + i);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':   'keep-alive',
        });

        const send = (event, data) => {
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        };
        const log = msg => {
          console.log(msg);
          send('log', { msg });
        };

        // Kill previous scan if still running
        if (scanState) {
          scanState.aborted = true;
          for (const p of scanState.procs) { try { p.kill('SIGKILL'); } catch {} }
        }
        scanState = { aborted: false, procs: new Set() };
        const state = scanState;

        send('start', { total: work.length, mode });

        let idx = 0, done = 0;
        const activeMap = new Map(); // port → {ip, protocol}

        const next = () => {
          while (ports.length > 0 && idx < work.length && !state.aborted) {
            const port = ports.shift();
            const { ip, protocol } = work[idx++];
            activeMap.set(port, { ip, protocol });
            send('active', { list: [...activeMap.values()] });

            const testOpts = { dnsttPath, pubkey, tunnelDomain, stealth, startupMs, testMs, state, log };
            testOne(ip, protocol, port, testOpts).then(result => {
              ports.push(port);
              activeMap.delete(port);
              done++;
              send('result',   result);
              send('progress', { done, total: work.length, active: activeMap.size });
              send('active',   { list: [...activeMap.values()] });
              if (done === work.length || state.aborted) {
                send('done', { total: work.length, done });
                res.end();
              } else {
                next();
              }
            });
          }
        };

        next();
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
}).listen(SERVER_PORT, () => {
process.on('uncaughtException',    e => console.error('uncaughtException:', e.message));
process.on('unhandledRejection',   e => console.error('unhandledRejection:', e));

  console.log(`✅  DNS Tunnel Final Tester  →  http://localhost:${SERVER_PORT}`);
  console.log(`    pubkey : ${DEFAULT_PUBKEY}`);
  console.log(`    domain : ${DEFAULT_TUNNEL_DOMAIN}`);
  console.log(`    SOCKS5 : 127.0.0.1:${BASE_SOCKS_PORT}…${BASE_SOCKS_PORT + 9}`);
  if (!DNSTT_CLIENT_PATH) {
    console.log(`\n⚠️   مسیر dnstt-client تنظیم نشده.`);
    console.log(`    روش ۱: DNSTT_CLIENT=/path/to/dnstt-client node tunnel-server.js`);
    console.log(`    روش ۲: در UI ابزار مسیر را وارد کنید.\n`);
  }
});
