/**
 * Flipkart Vendor Hub Login and Download PO Combined Task
 * Performs complete flow: Login -> Select FKI -> Download all POs -> Combine files
 */

import { BaseTask } from '../../core/BaseTask.js';
import { FlipkartLoginTask } from './login.js';
import { FlipkartDownloadPOTask } from './download-po.js';

export class FlipkartLoginAndDownloadPOTask extends BaseTask {
  constructor(taskConfig) {
    super(taskConfig);
    this.flipkartEmail = taskConfig.flipkartEmail;
    this.flipkartPassword = taskConfig.flipkartPassword;
    this.companyName = taskConfig.companyName || '';
    this.downloadPath = taskConfig.downloadPath || './downloads/flipkart';
    this.maxOrders = taskConfig.maxOrders || 0; // 0 = all orders
  }

  /**
   * Main combined flow
   */
  async run() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 FLIPKART LOGIN AND DOWNLOAD PO');
    console.log('='.repeat(60));
    console.log(`📧 Email: ${this.flipkartEmail}`);
    console.log(`📁 Download Path: ${this.downloadPath}`);
    console.log('='.repeat(60) + '\n');

    // ========== PHASE 1: LOGIN ==========
    console.log('\n📌 PHASE 1: LOGIN\n');

    this.loginTask = new FlipkartLoginTask({
      flipkartEmail: this.flipkartEmail,
      flipkartPassword: this.flipkartPassword,
      companyName: this.companyName
    });

    // Share browser context with login task
    this.loginTask.setBrowserContext(this.browser, this.context, this.page);

    // Run login
    await this.loginTask.run();

    console.log('\n✅ Phase 1 completed: Logged in successfully');

    // ========== PHASE 2: DOWNLOAD POs ==========
    console.log('\n📌 PHASE 2: DOWNLOAD AND COMBINE POs\n');

    const downloadTask = new FlipkartDownloadPOTask({
      downloadPath: this.downloadPath,
      maxOrders: this.maxOrders
    });

    // Share browser context with download task
    downloadTask.setBrowserContext(this.browser, this.context, this.page);

    // Run download
    await downloadTask.run();

    console.log('\n✅ Phase 2 completed: POs downloaded and combined');

    console.log('\n' + '='.repeat(60));
    console.log('✅ FLIPKART LOGIN AND DOWNLOAD PO COMPLETED');
    console.log('='.repeat(60) + '\n');
  }
}
