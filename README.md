# Filflo Flipkart Bot

Automate your Flipkart Vendor Hub purchase order downloads. No more manual clicking through dozens of POs.

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Playwright](https://img.shields.io/badge/Playwright-Browser%20Automation-blue?logo=playwright)
![License](https://img.shields.io/badge/License-ISC-yellow)

---

## The Problem

If you're a Flipkart seller, you know the pain:
- Login to Vendor Hub
- Navigate to PO section
- Download each PO individually
- Manually combine them into one sheet

**Multiply this by 50+ POs daily.** Hours wasted on repetitive clicks.

## The Solution

This bot automates the entire workflow:

```bash
npm run download-po
```

That's it. Go grab a coffee while it:
1. Logs into Flipkart Vendor Hub
2. Navigates to your Purchase Orders
3. Downloads each PO automatically
4. Combines everything into a single Excel file

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js** | Runtime environment |
| **Playwright** | Browser automation |
| **Commander.js** | CLI interface |
| **xlsx** | Excel file processing |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/profvyas/filflo-flipkart-bot.git
cd filflo-flipkart-bot
npm install
npx playwright install chromium
```

### 2. Configure

Create a `.env` file:

```env
FLIPKART_EMAIL=your-email@example.com
FLIPKART_PASSWORD=your-password
COMPANY_NAME=YOUR COMPANY NAME HERE

DOWNLOAD_PATH=./downloads/flipkart
MAX_ORDERS=0  # 0 = download all
```

### 3. Run

```bash
# With visible browser (recommended for first run - you'll need to solve CAPTCHA)
npm run download-po -- --no-headless

# Headless mode
npm run download-po:headless
```

---

## Output

The bot generates a combined Excel file with all your POs:

```
downloads/flipkart/filflo_flipkart_po_2024-01-15.xlsx
```

All order data flattened and ready for your ERP/inventory system.

---

## How It Works

```
┌─────────────────┐
│   Start Bot     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Login to       │
│  Vendor Hub     │◄──── You solve CAPTCHA once
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Navigate to    │
│  PO List        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Download Each  │
│  PO File        │──── Automated loop
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Merge & Save   │
│  Combined XLS   │
└─────────────────┘
```

---

## Why I Built This

As a Flipkart seller, I was spending 2+ hours daily just downloading POs. This bot reduced that to under 5 minutes.

**Time saved per week: ~10 hours**

---

## Contributing

PRs welcome! Some ideas:
- [ ] Add support for other marketplaces (Amazon, Myntra)
- [ ] Scheduled/cron-based downloads
- [ ] Direct ERP integrations

---

## Disclaimer

This tool is for personal use to automate your own Flipkart Vendor Hub account. Use responsibly and in accordance with Flipkart's terms of service.

---

**Built to save time for Flipkart sellers.**
