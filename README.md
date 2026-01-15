# Filflo Flipkart Bot

Automation bot for downloading Purchase Orders from Flipkart Vendor Hub.

## Features

- Automated login to Flipkart Vendor Hub
- Downloads individual PO files from each row
- Flattens PO data into normalized structure
- Combines all POs into a single Excel file with Filflo branding

## Setup

1. Install dependencies:
```bash
npm install
npx playwright install chromium
```

2. Configure `.env` file:
```env
FLIPKART_EMAIL=your-email@example.com
FLIPKART_PASSWORD="your-password"
DOWNLOAD_PATH=./downloads/flipkart
MAX_ORDERS=3  # Set to 0 for all orders
```

## Usage

### Download POs (with visible browser)
```bash
npm run download-po
```

### Download POs (headless mode)
```bash
npm run download-po:headless
```

### With custom options
```bash
node src/index.js download-po --max-orders 10 --no-headless
```

## Output

Downloaded POs are flattened and combined into a single file:
`downloads/flipkart/filflo_flipkart_po_YYYY-MM-DDTHH-MM-SS.xlsx`

### Output Structure
Each row contains:
- **PO_Number** - Purchase Order ID
- **Category** - Product category
- **Order_Date** - Order date
- **PO_Expiry** - PO expiry date
- **Supplier_Name** - Supplier name
- **Payment_Term** - Payment terms
- **S. no.** - Line item number
- **HSN/SA Code** - HSN code
- **FSN/ISBN13** - Flipkart SKU
- **Quantity** - Ordered quantity
- **Title** - Product title
- And more...

## Manual Steps

During login, you need to:
1. Solve the reCAPTCHA
2. Click the Sign In button

The bot will automatically take over after login.
