#!/usr/bin/env node

/**
 * Filflo Flipkart Bot
 * Downloads Purchase Orders from Flipkart Vendor Hub
 */

import { Command } from 'commander';
import { config } from './config/index.js';
import { FlipkartLoginAndDownloadPOTask } from './tasks/flipkart/login-and-download-po.js';

const program = new Command();

program
  .name('filflo-flipkart')
  .description('Filflo automation bot for Flipkart Vendor Hub')
  .version('1.0.0');

program
  .command('download-po')
  .description('Login to Flipkart Vendor Hub and download Purchase Orders')
  .option('--headless', 'Run in headless mode (no browser window)')
  .option('--no-headless', 'Run with visible browser window')
  .option('--max-orders <number>', 'Maximum number of orders to download', parseInt)
  .action(async (options) => {
    const headless = options.headless !== undefined ? options.headless : config.browser.headless;
    const maxOrders = options.maxOrders || config.flipkart.maxOrders;

    console.log('\n============================================================');
    console.log('🚀 FILFLO FLIPKART PO DOWNLOADER');
    console.log('============================================================');
    console.log(`📧 Email: ${config.flipkart.email}`);
    console.log(`📁 Download Path: ${config.flipkart.downloadPath}`);
    console.log(`📊 Max Orders: ${maxOrders || 'All'}`);
    console.log(`🖥️  Headless: ${headless}`);
    console.log('============================================================\n');

    const task = new FlipkartLoginAndDownloadPOTask({
      headless,
      flipkartEmail: config.flipkart.email,
      flipkartPassword: config.flipkart.password,
      companyName: config.flipkart.companyName,
      downloadPath: config.flipkart.downloadPath,
      maxOrders: maxOrders
    });

    await task.execute();
  });

// Default command - show help
program
  .action(() => {
    program.help();
  });

program.parse();
