const dgram = require('dgram');
const net   = require('net');
const http  = require('http');
const crypto = require('crypto');

function buildDNSQuery(domain, type) {
  const txid = Math.floor(Math.random() * 65535);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(txid, 0);
  header.writeUInt16BE(0x0100, 2); // RD=1
  header.writeUInt16BE(1, 4);
  const labels = domain.split('.').reduce((buf, part) => {
    const b = Buffer.alloc(part.length + 1);
    b.writeUInt8(part.length, 0); b.write(part, 1);
    return Buffer.concat([buf, b]);
  }, Buffer.alloc(0));
  const question = Buffer.alloc(labels.length + 5);
  labels.copy(question);
  question.writeUInt8(0, labels.length);
  question.writeUInt16BE(type || 1, labels.length + 1);
  question.writeUInt16BE(1,         labels.length + 3);
  return Buffer.concat([header, question]);
}

function parseDNS(buf) {
  if (!buf || buf.length < 12) return { ok: false };
  const flags   = buf.readUInt16BE(2);
  const rcode   = flags & 0xf;
  const ancount = buf.readUInt16BE(6);
  const qr      = (flags >> 15) & 1;
  return { ok: true, rcode, ancount, hasAnswer: ancount > 0, isResponse: qr === 1 };
}

// ─── UDP query — با resolver مشخص ─────────────────────────────────────────────
function udpQuery(resolverIP, domain, qtype, timeout) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const pkt  = buildDNSQuery(domain, qtype || 1);
    let done = false; const t0 = Date.now();
    const fin = (ok, parsed) => {
      if (done) return; done = true;
      clearTimeout(timer); try { sock.close(); } catch {}
      resolve({ ok, latency: ok ? Date.now() - t0 : -1, parsed });
    };
    const timer = setTimeout(() => fin(false, null), timeout || 3000);
    sock.once('error',   ()  => fin(false, null));
    sock.once('message', msg => fin(true, parseDNS(msg)));
    sock.send(pkt, 0, pkt.length, 53, resolverIP, err => { if (err) fin(false, null); });
  });
}

// ─── TCP DNS query ─────────────────────────────────────────────────────────────
function tcpDnsQuery(resolverIP, domain, qtype, timeout) {
  return new Promise(resolve => {
    const pkt   = buildDNSQuery(domain, qtype || 1);
    const frame = Buffer.alloc(pkt.length + 2);
    frame.writeUInt16BE(pkt.length, 0); pkt.copy(frame, 2);
    const sock = new net.Socket(); let done = false; const t0 = Date.now();
    const fin = ok => { if (done) return; done = true; sock.destroy(); resolve({ ok, latency: ok ? Date.now() - t0 : -1 }); };
    sock.setTimeout(timeout || 4000);
    sock.once('timeout', () => fin(false)); sock.once('error', () => fin(false));
    sock.connect(53, resolverIP, () => sock.write(frame));
    sock.on('data', d => { if (d.length >= 2) fin(true); });
  });
}

// ─── Real dnstt tunnel test ────────────────────────────────────────────────────
// query می‌کنیم <random>.tunnelDomain TXT از طریق همین resolver
// اگه resolver جواب برگردونه (حتی NXDOMAIN) یعنی query به VPS رسید = tunnel کار می‌کنه
// SERVFAIL یا timeout = resolver forward نکرد یا بلاک شد
async function testDnsTunnel(resolverIP, tunnelDomain, timeout) {
  if (!tunnelDomain) return { ok: false, rcode: -1, latency: -1, reason: 'no domain' };

  // یه subdomain random می‌سازیم تا cache نخوره
  const rand = crypto.randomBytes(6).toString('hex');
  const testDomain = `${rand}.${tunnelDomain}`;

  const r = await udpQuery(resolverIP, testDomain, 16, timeout || 5000); // TXT query
  if (!r.ok) return { ok: false, rcode: -1, latency: r.latency, reason: 'timeout' };

  const p = r.parsed;
  if (!p || !p.ok) return { ok: false, rcode: -1, latency: r.latency, reason: 'bad response' };

  // NOERROR (0) یا NXDOMAIN (3) = query به VPS رسید = tunnel OK
  // SERVFAIL (2) یا REFUSED (5) = بلاک شد یا forward نکرد
  const tunnelOk = p.rcode === 0 || p.rcode === 3;
  const rcodeNames = { 0:'NOERROR', 1:'FORMERR', 2:'SERVFAIL', 3:'NXDOMAIN', 5:'REFUSED' };

  return {
    ok:      tunnelOk,
    rcode:   p.rcode,
    rcodeName: rcodeNames[p.rcode] || `RCODE${p.rcode}`,
    latency: r.latency,
    reason:  tunnelOk ? `${rcodeNames[p.rcode]||p.rcode} → query reached VPS` : `${rcodeNames[p.rcode]||p.rcode} → blocked/no-forward`,
  };
}

// ─── DNS Tunnel Handshake (TCP/53 bidirectional) ───────────────────────────────
function testTCPTunnelHS(resolverIP, tunnelDomain, timeout) {
  return new Promise(resolve => {
    const domain = tunnelDomain || 'google.com';
    const pkt    = buildDNSQuery(domain, 16);
    const frame  = Buffer.alloc(pkt.length + 2);
    frame.writeUInt16BE(pkt.length, 0); pkt.copy(frame, 2);
    const sock = new net.Socket(); let done = false; const t0 = Date.now();
    const fin = ok => { if (done) return; done = true; sock.destroy(); resolve({ ok, latency: ok ? Date.now() - t0 : -1 }); };
    sock.setTimeout(timeout || 4000);
    sock.once('timeout', () => fin(false)); sock.once('error', () => fin(false));
    sock.connect(53, resolverIP, () => sock.write(frame));
    sock.on('data', d => { if (d.length >= 2) fin(true); });
  });
}

// ─── SSH Handshake ─────────────────────────────────────────────────────────────
function testSSHHS(ip, timeout) {
  return new Promise(resolve => {
    const sock = new net.Socket(); let done = false, banner = ''; const t0 = Date.now();
    const fin = (ok, info) => { if (done) return; done = true; sock.destroy(); resolve({ ok, latency: ok ? Date.now() - t0 : -1, banner: info || '' }); };
    sock.setTimeout(timeout || 4000);
    sock.once('timeout', () => fin(false)); sock.once('error', () => fin(false));
    sock.connect(22, ip, () => {});
    sock.on('data', d => {
      banner += d.toString('ascii', 0, Math.min(d.length, 256));
      if (banner.includes('SSH-')) fin(true, banner.split('\n')[0].trim());
      else if (banner.length > 512) fin(false);
    });
  });
}

// ─── تست کامل یک IP ────────────────────────────────────────────────────────────
async function testResolver(ip, opts, range, onStep) {
  const { tunnelDomain, e2eTimeout, tcpTimeout, udpTimeout } = opts;
  const r = {
    ip, range,
    udp: false, udpLatency: -1,
    tcp53: false, tcp53Latency: -1,
    recursive: false, txtSupport: false, largeTxt: false,
    tcpTunnelHS: false, tcpTunnelLatency: -1,
    // real dnstt tunnel test
    tunnelOk: false, tunnelLatency: -1, tunnelRcode: '', tunnelReason: '',
    sshHS: false, sshLatency: -1, sshBanner: '',
    score: 0, status: 'testing',
  };
  try {
    onStep(ip, 'UDP');
    const u = await udpQuery(ip, 'google.com', 1, udpTimeout || 3000);
    r.udp = u.ok; r.udpLatency = u.latency;
    if (u.ok && u.parsed) r.recursive = u.parsed.hasAnswer;

    onStep(ip, 'TCP');
    const t = await tcpDnsQuery(ip, 'google.com', 1, tcpTimeout || 4000);
    r.tcp53 = t.ok; r.tcp53Latency = t.latency;

    onStep(ip, 'TXT');
    const txt = await udpQuery(ip, 'google.com', 16, udpTimeout || 3000);
    if (txt.ok && txt.parsed) r.txtSupport = txt.parsed.ok;

    onStep(ip, 'LTXT');
    const lt = await udpQuery(ip, '_dmarc.google.com', 16, udpTimeout || 3500);
    if (lt.ok && lt.parsed) r.largeTxt = lt.parsed.hasAnswer;

    onStep(ip, 'TCP-HS');
    const tcphs = await testTCPTunnelHS(ip, tunnelDomain, tcpTimeout || 4000);
    r.tcpTunnelHS = tcphs.ok; r.tcpTunnelLatency = tcphs.latency;

    // ─── Real dnstt tunnel test ────────────────────────────────────────────────
    onStep(ip, 'TUNNEL');
    const tun = await testDnsTunnel(ip, tunnelDomain, e2eTimeout || 6000);
    r.tunnelOk      = tun.ok;
    r.tunnelLatency  = tun.latency;
    r.tunnelRcode    = tun.rcodeName || '';
    r.tunnelReason   = tun.reason || '';

    onStep(ip, 'SSH');
    const ssh = await testSSHHS(ip, 4000);
    r.sshHS = ssh.ok; r.sshLatency = ssh.latency; r.sshBanner = ssh.banner;

    // امتیاز
    let s = 0;
    if (r.udp)          s += 10;
    if (r.tcp53)        s += 10;
    if (r.recursive)    s += 15;
    if (r.txtSupport)   s += 10;
    if (r.largeTxt)     s += 10;
    if (r.tcpTunnelHS)  s += 10;
    if (r.tunnelOk)     s += 30;  // مهم‌ترین تست
    if (r.sshHS)        s +=  5;
    if (r.udpLatency > 0 && r.udpLatency < 100)  s += 5;
    else if (r.udpLatency > 0 && r.udpLatency < 300) s += 2;
    r.score = Math.min(s, 100);

    r.status = r.tunnelOk ? 'pass'
             : (r.recursive && r.txtSupport) ? 'partial'
             : 'fail';
  } catch { r.status = 'error'; }
  return r;
}

// ─── CIDR expand ──────────────────────────────────────────────────────────────
function expandCIDR(cidr) {
  const [base, prefix] = cidr.split('/'); const p = parseInt(prefix);
  if (p < 16) return [];
  const parts = base.split('.').map(Number);
  if (p === 32) return [base];
  const baseInt = (parts[0]<<24|parts[1]<<16|parts[2]<<8|parts[3])>>>0;
  const mask    = p === 0 ? 0 : (~0 << (32-p))>>>0;
  const network = (baseInt & mask)>>>0;
  const count   = Math.pow(2, 32-p);
  const ips = [];
  for (let i = 1; i < count-1; i++) {
    const n = (network+i)>>>0;
    ips.push(`${(n>>>24)&0xff}.${(n>>>16)&0xff}.${(n>>>8)&0xff}.${n&0xff}`);
  }
  return ips;
}

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0]<<24)|(p[1]<<16)|(p[2]<<8)|p[3])>>>0;
}
function intToIp(n) {
  return `${(n>>>24)&0xff}.${(n>>>16)&0xff}.${(n>>>8)&0xff}.${n&0xff}`;
}
function expandDashRange(range) {
  const [startIP, endIP] = range.split('-').map(s => s.trim());
  if (!startIP || !endIP) return [];
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(startIP) || !/^\d+\.\d+\.\d+\.\d+$/.test(endIP)) return [];
  const start = ipToInt(startIP), end = ipToInt(endIP);
  if (end < start || end - start > 65535) return []; // max 65535 برای جلوگیری از abuse
  const ips = [];
  for (let i = start; i <= end; i++) ips.push(intToIp(i));
  return ips;
}

function parseRanges(raw) {
  const groups = []; let curLabel = 'Range 1', curIPs = [], rangeNum = 1;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) {
      if (curIPs.length) { groups.push({ label: curLabel, ips: [...curIPs] }); rangeNum++; curLabel = `Range ${rangeNum}`; curIPs = []; }
      continue;
    }
    if (t.startsWith('#')) { curLabel = t.slice(1).trim() || `Range ${rangeNum}`; continue; }
    const ip = t.split(/[\s,;]/)[0];
    if (ip.includes('/')) curIPs.push(...expandCIDR(ip).map(e => ({ ip: e, range: curLabel })));
    else if (ip.includes('-')) curIPs.push(...expandDashRange(ip).map(e => ({ ip: e, range: curLabel })));
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) curIPs.push({ ip, range: curLabel });
  }
  if (curIPs.length) groups.push({ label: curLabel, ips: curIPs });
  const seen = new Set();
  return groups
    .map(g => ({ label: g.label, ips: g.ips.filter(e => { if (seen.has(e.ip)) return false; seen.add(e.ip); return true; }) }))
    .filter(g => g.ips.length > 0);
}

// ─── scan state ───────────────────────────────────────────────────────────────
let scanState = null;

const PORT = 3737;
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && url.pathname === '/pause') {
    if (scanState) scanState.paused = true;
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }
  if (req.method === 'POST' && url.pathname === '/resume') {
    if (scanState) { scanState.paused = false; scanState.resumeFn && scanState.resumeFn(); }
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }
  if (req.method === 'POST' && url.pathname === '/stop') {
    if (scanState) scanState.aborted = true;
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }

  if (req.method === 'POST' && url.pathname === '/scan') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const {
          ranges, tunnelDomain, concurrency = 40,
          udpTimeout = 3000, tcpTimeout = 4000, e2eTimeout = 6000,
        } = JSON.parse(body);

        const groups = parseRanges(ranges);
        const allIPs = groups.flatMap(g => g.ips);
        const opts   = { tunnelDomain, udpTimeout, tcpTimeout, e2eTimeout };

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

        scanState = { paused: false, aborted: false, resumeFn: null };
        const state = scanState;

        send('start', { total: allIPs.length, groups: groups.map(g => ({ label: g.label, count: g.ips.length })) });

        let idx = 0, active = 0, done = 0;
        const activeIPs = new Map();

        const waitIfPaused = () => new Promise(resolve => {
          if (!state.paused) { resolve(); return; }
          state.resumeFn = resolve;
        });

        const next = async () => {
          while (active < concurrency && idx < allIPs.length && !state.aborted) {
            await waitIfPaused();
            if (state.aborted) break;
            const { ip, range } = allIPs[idx++];
            active++;
            activeIPs.set(ip, { range, step: '—' });
            send('testing', { ip, range });

            testResolver(ip, opts, range, (ip, step) => {
              if (activeIPs.has(ip)) activeIPs.get(ip).step = step;
              send('step', { ip, step });
              send('active', { list: [...activeIPs.entries()].map(([k, v]) => ({ ip: k, ...v })) });
            }).then(r => {
              active--; done++;
              activeIPs.delete(ip);
              send('result', r);
              send('progress', { done, total: allIPs.length, active });
              send('active', { list: [...activeIPs.entries()].map(([k, v]) => ({ ip: k, ...v })) });
              if (done === allIPs.length || state.aborted) { send('done', {}); res.end(); }
              else next();
            });
          }
        };
        next();
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  if (url.pathname === '/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => {
  console.log(`✅ DNS Tester  →  http://localhost:${PORT}`);
  console.log(`   Real tunnel test: <random>.<tunnelDomain> TXT via each resolver`);
  console.log(`   NOERROR/NXDOMAIN = tunnel OK | SERVFAIL/timeout = blocked`);
});
