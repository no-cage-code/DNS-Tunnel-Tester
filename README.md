# DNS Tunnel Tester

**[فارسی](#فارسی)** | **[English](#english)**

---

<a name="فارسی"></a>
## 🇮🇷 فارسی

دو ابزار مکمل برای پیدا کردن و تست واقعی DNS resolverهایی که تونل **dnstt** از طریقشون کار می‌کنه.
مخصوص شبکه‌هایی که DNS فیلتر یا محدود شده.

---

### ✨ قابلیت‌ها

**اسکنر (server.js + index.html)**
- اسکن همزمان چندین رنج IP با concurrency قابل تنظیم
- تست تونل DNS (query واقعی به subdomain)
- سیستم امتیازدهی هوشمند برای هر resolver
- رابط وب لایو با نمایش پیشرفت real-time
- پشتیبانی از pause / resume / stop
- تشخیص SSH banner روی IP های پیدا شده

**تستر نهایی (tunnel-server.js + tunnel-tester.html)**
- اجرای واقعی `dnstt-client` به ازای هر IP
- تست SOCKS5 end-to-end (داده واقعی از طریق تانل رد می‌شه)
- workers موازی با port pool جداگانه
- نمایش live log از stderr فرایندها
- خروجی CSV و لیست IP های pass

---

### ⚙️ پیش‌نیازها

- [Node.js](https://nodejs.org) نسخه ۱۸ یا بالاتر
- یه VPS با `dnstt-server` نصب شده
- یه دامنه که NS اش به VPS اشاره کنه
- باینری `dnstt-client` (برای تستر نهایی)

---

### 🚀 نصب و اجرا

```bash
git clone https://github.com/no-cage-code/DNS-Tunnel-Tester.git
cd DNS-Tunnel-Tester
```

**مرحله ۱ — تنظیم config:**

```bash
cp config.example.js config.js
# config.js رو باز کن و pubkey و tunnel domain خودت رو وارد کن
```

**مرحله ۲ — اسکنر اولیه:**

```bash
node server.js
# باز کن: http://localhost:3737
```

**مرحله ۳ — تستر نهایی:**

```bash
DNSTT_CLIENT=/path/to/dnstt-client node tunnel-server.js
# باز کن: http://localhost:3738
```

---

### 📖 گردش کار پیشنهادی

1. **اسکنر اولیه** → رنج IP های CIDR رو وارد کن، tunnel domain بده، اسکن کن
2. IP های `pass` رو export کن
3. **تستر نهایی** → لیست IP ها رو بده، `dnstt-client` واقعی روشون تست می‌کنه
4. IP های تأیید شده رو توی اپ خودت استفاده کن

---

### 🔬 تفاوت دو ابزار

| | اسکنر | تستر نهایی |
|--|-------|------------|
| روش تست | DNS query به subdomain | اجرای dnstt-client + SOCKS5 |
| سرعت | سریع (هزاران IP) | کند (هر IP ~25s) |
| دقت | متوسط | بالا (end-to-end) |
| نیاز به binary | ندارد | دارد |

---

### ⚙️ config.js

```js
module.exports = {
  PUBKEY:        'your_dnstt_server_public_key_hex',
  TUNNEL_DOMAIN: 'your.tunnel.domain.com',
};
```

این فایل gitignore شده و هرگز commit نمی‌شه.
می‌تونی از env var هم استفاده کنی:

```bash
DNSTT_PUBKEY=abc123 DNSTT_DOMAIN=t.example.com node tunnel-server.js
```

---

### 📊 سیستم امتیازدهی (اسکنر)

| تست | امتیاز |
|-----|--------|
| UDP فعال | +10 |
| TCP/53 فعال | +10 |
| Recursive resolver | +15 |
| پشتیبانی TXT | +10 |
| TXT بزرگ | +10 |
| TCP Handshake | +10 |
| **تست تونل (مهم‌ترین)** | **+30** |
| SSH باز | +5 |
| لیتنسی پایین | +5 |

- امتیاز ≥ 70 → `pass` ✅
- امتیاز 40–69 → `partial` ⚠️
- امتیاز < 40 → `fail` ❌

---

### 💡 نکات

- از رنج `/24` استفاده کن، نه `/16`
- اسکنر: concurrency بین 50 تا 100 بهینه‌ست
- تستر نهایی: concurrency پایین‌تر (5) به دلیل spawn فرایند واقعی
- test timeout رو روی حداقل 25000ms بذار (تانل DNS کند است)

---
---

<a name="english"></a>
## 🌐 English

Two complementary tools to discover and end-to-end verify DNS resolvers that work with [dnstt](https://www.bamsoftware.com/software/dnstt/) tunnels.
Built for heavily filtered networks where standard DNS is restricted.

---

### ✨ Features

**Scanner (server.js + index.html)**
- Concurrent scanning of multiple CIDR IP ranges
- Real DNS tunnel test (query to your tunnel subdomain)
- Smart scoring system per resolver
- Live web UI with real-time progress
- Pause / Resume / Stop support
- SSH banner detection

**Final Tester (tunnel-server.js + tunnel-tester.html)**
- Spawns real `dnstt-client` binary per IP
- End-to-end SOCKS5 test (actual traffic through tunnel)
- Parallel workers with separate port pool
- Live stderr log stream from child processes
- CSV export and pass-IP list export

---

### ⚙️ Requirements

- [Node.js](https://nodejs.org) >= 18
- A VPS running `dnstt-server`
- A domain with NS records pointing to your VPS
- `dnstt-client` binary (for the final tester)

---

### 🚀 Quick Start

```bash
git clone https://github.com/no-cage-code/DNS-Tunnel-Tester.git
cd DNS-Tunnel-Tester
```

**Step 1 — Configure:**

```bash
cp config.example.js config.js
# Edit config.js with your pubkey and tunnel domain
```

**Step 2 — Run scanner:**

```bash
node server.js
# Open: http://localhost:3737
```

**Step 3 — Run final tester:**

```bash
DNSTT_CLIENT=/path/to/dnstt-client node tunnel-server.js
# Open: http://localhost:3738
```

---

### 📖 Recommended workflow

1. **Scanner** → enter CIDR ranges, set tunnel domain, scan
2. Export `pass` IPs
3. **Final tester** → paste IP list, tests with real `dnstt-client`
4. Use confirmed IPs in your tunnel client app

---

### 🔬 Scanner vs Final Tester

| | Scanner | Final Tester |
|--|---------|--------------|
| Method | DNS query to subdomain | Spawns dnstt-client + SOCKS5 |
| Speed | Fast (thousands of IPs) | Slow (~25s per IP) |
| Accuracy | Medium | High (end-to-end) |
| Needs binary | No | Yes |

---

### ⚙️ config.js

```js
module.exports = {
  PUBKEY:        'your_dnstt_server_public_key_hex',
  TUNNEL_DOMAIN: 'your.tunnel.domain.com',
};
```

This file is gitignored and never committed.
Environment variables are also supported:

```bash
DNSTT_PUBKEY=abc123 DNSTT_DOMAIN=t.example.com node tunnel-server.js
```

---

### 📊 Score System (Scanner)

| Test | Points |
|------|--------|
| UDP working | +10 |
| TCP/53 working | +10 |
| Recursive resolver | +15 |
| TXT support | +10 |
| Large TXT | +10 |
| TCP Handshake | +10 |
| **Tunnel test (most important)** | **+30** |
| SSH open | +5 |
| Low latency | +5 |

Score ≥ 70 → `pass` ✅ · 40–69 → `partial` ⚠️ · < 40 → `fail` ❌

---

### 💡 Tips

- Use `/24` ranges, not `/16`
- Scanner: concurrency 50–100 works well
- Final tester: keep concurrency low (5) due to real process spawning
- Set test timeout to at least 25000ms — DNS tunnels are inherently slow

---

### 📄 License

MIT
