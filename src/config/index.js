/**
 * Filflo Flipkart Bot Configuration
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  flipkart: {
    email: process.env.FLIPKART_EMAIL,
    password: process.env.FLIPKART_PASSWORD,
    companyName: process.env.COMPANY_NAME || '',
    downloadPath: process.env.DOWNLOAD_PATH || './downloads/flipkart',
    maxOrders: parseInt(process.env.MAX_ORDERS) || 0 // 0 = all orders
  },
  browser: {
    headless: process.env.HEADLESS !== 'false'
  }
};
