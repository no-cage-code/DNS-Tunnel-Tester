# dnstt-scanner

**[فارسی](#فارسی)** | **[English](#english)**

---

<a name="فارسی"></a>
## فارسی

ابزاری برای پیدا کردن DNS resolver هایی که تونل dnstt / slipnet از طریقشون کار می‌کنه.
برای شبکه‌هایی طراحی شده که DNS فیلتر یا محدود شده.

### چطور کار می‌کنه

برای هر IP یه سری تست انجام می‌شه. مهم‌ترین تست **TUNNEL** هست:

یه query به شکل `<random>.<tunnel-domain> TXT` از طریق همون resolver فرستاده می‌شه.
اگه resolver جواب بده (حتی NXDOMAIN) یعنی query به VPS رسیده و tunnel کار می‌کنه.
اگه SERVFAIL یا timeout بگیری یعنی resolver بلاک کرده.

### نیازمندی‌ها

- Node.js نسخه 18 یا بالاتر
- یه VPS با dnstt-server نصب شده
- یه دامنه که NS اش به VPS اشاره کنه

### اجرا

```bash
node server.js
```

بعد `index.html` رو تو مرورگر باز کن.

### نحوه استفاده

1. رنج IP ها رو وارد کن (فرمت CIDR)
2. tunnel domain رو بنویس — همون subdomain که NS اش به VPS اشاره می‌کنه
3. workers و timeout رو تنظیم کن
4. اسکن رو شروع کن

**فرمت ورودی:**
```
# اسم دلخواه برای گروه
102.23.226.0/24
5.160.0.0/24

# گروه دوم
94.182.0.0/24
```

### خوندن نتایج

| نتیجه | معنی |
|-------|------|
| TUNNEL ✓ + NOERROR یا NXDOMAIN | این resolver کار می‌کنه — بذارش تو کانفیگ dnstt |
| TUNNEL ✗ + SERVFAIL | resolver دامنه رو بلاک کرده |
| TUNNEL ✗ + timeout | resolver forward نمی‌کنه یا VPS جواب نمیده |

### بعد از پیدا کردن resolver

```bash
dnstt-client -udp RESOLVER_IP:53 -pubkey YOUR_PUBKEY ns.yourdomain.com 127.0.0.1:8080
```

---

<a name="english"></a>
## English

A web-based scanner to find DNS resolvers that work with [dnstt](https://www.bamsoftware.com/software/dnstt/) / [slipnet](https://github.com/ntnj/slipnet) tunnels.

Built for heavily filtered networks where standard DNS is restricted.

### How it works

For each IP it runs several tests. The key one is **TUNNEL**:

Sends `<random>.<tunnel-domain> TXT` via that resolver. If the resolver returns any response (even NXDOMAIN), the query reached your VPS and the tunnel works. SERVFAIL or timeout means the resolver is blocking it.

### Requirements

- Node.js >= 18
- A VPS running dnstt-server
- A domain with NS records pointing to your VPS

### Run

```bash
node server.js
```

Then open `index.html` in your browser.

### Usage

1. Enter IP ranges (CIDR format, blank line between groups)
2. Enter your tunnel domain — the subdomain whose NS points to your VPS
3. Adjust workers and timeouts
4. Start scan

**Input format:**
```
# optional group label
102.23.226.0/24
5.160.0.0/24

# second group
94.182.0.0/24
```

### Reading results

| Result | Meaning |
|--------|---------|
| TUNNEL ✓ + NOERROR or NXDOMAIN | Resolver works — add to dnstt config |
| TUNNEL ✗ + SERVFAIL | Resolver is blocking your domain |
| TUNNEL ✗ + timeout | Resolver doesn't forward or VPS unreachable |

### Using found resolvers

```bash
dnstt-client -udp RESOLVER_IP:53 -pubkey YOUR_PUBKEY ns.yourdomain.com 127.0.0.1:8080
```

### Score system

| Test | Points |
|------|--------|
| UDP working | +10 |
| TCP/53 working | +10 |
| Recursive resolver | +15 |
| TXT support | +10 |
| Large TXT | +10 |
| TCP Handshake | +10 |
| **Tunnel test** | **+30** |
| SSH open | +5 |
| Low latency | +5 |

Score ≥ 70 → `pass` · 40–69 → `partial` · < 40 → `fail`

### Notes

- Use `/24` ranges, not `/16` (too large)
- Concurrency 50–100 works well
- Set E2E timeout higher (6000ms+) on high-latency networks

### License

MIT
