# 🔍 DNSTT SSH Scanner

**[فارسی](#فارسی)** | **[English](#english)**

---

<a name="فارسی"></a>
<div dir="rtl">

## 🇮🇷 فارسی

ابزار وب‌محور برای پیدا کردن DNS resolverهایی که تونل **dnstt** / **slipnet** از طریقشون کار می‌کنه.  
مخصوص شبکه‌هایی که DNS فیلتر یا محدود شده.

---

### ✨ قابلیت‌ها

- اسکن همزمان چندین رنج IP با concurrency قابل تنظیم
- تست واقعی تونل dnstt (نه فقط ping ساده)
- سیستم امتیازدهی هوشمند برای هر resolver
- رابط وب لایو با نمایش پیشرفت real-time
- پشتیبانی از pause / resume / stop
- تشخیص SSH banner روی IP های پیدا شده

---

### ⚙️ پیش‌نیازها

- [Node.js](https://nodejs.org) نسخه ۱۸ یا بالاتر
- یه VPS با `dnstt-server` نصب شده
- یه دامنه که NS اش به VPS اشاره کنه

---

### 🚀 نصب و اجرا

```bash
git clone https://github.com/no-cage-code/DNS-Tunnel-Tester.git
cd DNS-Tunnel-Tester
node server.js
```

بعد `index.html` رو تو مرورگر باز کن.  
سرور روی پورت **3737** اجرا می‌شه.

---

### 📖 نحوه استفاده

1. رنج IP ها رو وارد کن (فرمت CIDR)
2. **tunnel domain** رو بنویس — همون subdomain که NS اش به VPS اشاره می‌کنه
3. workers و timeout رو تنظیم کن
4. اسکن رو شروع کن

**فرمت ورودی:**
```
# گروه اول
102.23.226.0/24
5.160.0.0/24

# گروه دوم
94.182.0.0/24
```

---

### 🔬 چطور کار می‌کنه؟

مهم‌ترین تست **TUNNEL** هست:

یه query به شکل `<random>.<tunnel-domain> TXT` از طریق همون resolver فرستاده می‌شه.

| نتیجه | معنی |
|-------|------|
| `NOERROR` یا `NXDOMAIN` | ✅ query به VPS رسید — tunnel کار می‌کنه |
| `SERVFAIL` | ❌ resolver دامنه رو بلاک کرده |
| `timeout` | ❌ resolver forward نمی‌کنه یا VPS جواب نمیده |

---

### 📊 سیستم امتیازدهی

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

### 🛠️ استفاده از resolver های پیدا شده

بعد از اسکن، IP هایی که وضعیتشون `pass` ✅ هست رو کپی کن.

این IP ها رو می‌تونی مستقیم تو اپ‌هایی مثل **slipnet** یا هر کلاینتی که آدرس DNS resolver می‌خواد وارد کنی — این resolverها تضمین شده که query های تونل رو به VPS تو forward می‌کنن و فیلتر نمی‌شن.

---

### 💡 نکات

- از رنج `/24` استفاده کن، نه `/16` (خیلی بزرگه)
- concurrency بین 50 تا 100 بهینه‌ست
- روی شبکه‌های پرلیتنسی، E2E timeout رو بذار 6000ms یا بیشتر

</div>

---
---

<a name="english"></a>
## 🌐 English

A web-based scanner to find DNS resolvers that work with [dnstt](https://www.bamsoftware.com/software/dnstt/) / [slipnet](https://github.com/ntnj/slipnet) tunnels.  
Built for heavily filtered networks where standard DNS is restricted.

---

### ✨ Features

- Concurrent scanning of multiple IP ranges
- Real dnstt tunnel test (not just a ping)
- Smart scoring system per resolver
- Live web UI with real-time progress
- Pause / Resume / Stop support
- SSH banner detection on discovered IPs

---

### ⚙️ Requirements

- [Node.js](https://nodejs.org) >= 18
- A VPS running `dnstt-server`
- A domain with NS records pointing to your VPS

---

### 🚀 Quick Start

```bash
git clone https://github.com/no-cage-code/DNS-Tunnel-Tester.git
cd DNS-Tunnel-Tester
node server.js
```

Open `index.html` in your browser. Server runs on port **3737**.

---

### 📖 Usage

1. Enter IP ranges (CIDR format, blank line between groups)
2. Enter your **tunnel domain** — the subdomain whose NS points to your VPS
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

---

### 🔬 How it works

The key test is **TUNNEL**:

Sends `<random>.<tunnel-domain> TXT` via each resolver being tested.

| Result | Meaning |
|--------|---------|
| `NOERROR` or `NXDOMAIN` | ✅ Query reached VPS — tunnel works |
| `SERVFAIL` | ❌ Resolver is blocking your domain |
| `timeout` | ❌ Resolver doesn't forward or VPS unreachable |

---

### 📊 Score System

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

### 🛠️ Using found resolvers

After the scan, copy the IPs that show `pass` ✅.

Paste these IPs directly into apps like **slipnet** or any client that accepts a DNS resolver address — these resolvers are confirmed to forward tunnel queries to your VPS without blocking them.

---

### 💡 Tips

- Use `/24` ranges, not `/16` (too large to scan)
- Concurrency 50–100 works well
- Set E2E timeout to 6000ms+ on high-latency networks

---

### 📄 License

MIT
