/**
 * Flipkart Vendor Hub Download PO Task
 * Downloads all available POs and combines them into a single XLS file
 */

import { BaseTask } from '../../core/BaseTask.js';
import { mergeXlsFiles, generateMergedFilename, flattenAndMergePoFiles } from '../../utils/xls-merger.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

export class FlipkartDownloadPOTask extends BaseTask {
  constructor(taskConfig) {
    super(taskConfig);
    this.downloadPath = taskConfig.downloadPath || './downloads/flipkart';
    this.tempDir = path.join(os.tmpdir(), 'flipkart-po-downloads-' + Date.now());
    this.maxOrders = taskConfig.maxOrders || 0; // 0 = all orders
  }

  /**
   * Main download flow
   */
  async run() {
    console.log('\n📋 Starting Flipkart PO Download...\n');

    // Ensure download directories exist
    this.ensureDirectoriesExist();

    // Step 1: Navigate to PO list page
    await this.navigateToPOList();

    // Step 2: Set pagination to 50 POs per page
    await this.setPaginationTo50();

    // Step 3: Download all individual PO files from each row
    const downloadedFiles = await this.downloadAllPOs();

    if (downloadedFiles.length === 0) {
      console.log('\n⚠️  No PO files were downloaded');
      return;
    }

    // Step 4: Flatten and combine all downloaded files
    const combinedFile = await this.combineFiles(downloadedFiles);

    // Step 5: Cleanup temp files
    this.cleanupTempFiles(downloadedFiles);

    console.log(`\n✅ Flipkart PO download completed!`);
    console.log(`📁 Combined file saved: ${combinedFile}\n`);
  }

  /**
   * Ensure download directories exist
   */
  ensureDirectoriesExist() {
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
      console.log(`📁 Created download directory: ${this.downloadPath}`);
    }

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      console.log(`📁 Created temp directory: ${this.tempDir}`);
    }
  }

  /**
   * Navigate to PO list page
   */
  async navigateToPOList() {
    console.log('🌐 Navigating to PO list page...');
    await this.navigateTo('https://vendorhub.flipkart.com/#/operations/po/list?status=open');
    console.log('⏳ Waiting for PO data to load...');
    await this.page.waitForTimeout(8000); // Wait longer for data to load
    console.log('✅ PO list page loaded');
  }

  /**
   * Set pagination dropdown to show 50 POs per page
   */
  async setPaginationTo50() {
    console.log('\n📊 Setting POs per page to 50...');

    try {
      // Look for pagination dropdown at the bottom of the table
      // It typically shows "10" initially and has options like 10, 25, 50
      const paginationSelectors = [
        'select:has(option[value="50"])',
        '[role="combobox"]',
        'select',
        'button:has-text("10")',
        '[class*="pagination"] select',
        '[class*="page-size"]'
      ];

      // Try to find and click the pagination dropdown
      let dropdownFound = false;

      for (const selector of paginationSelectors) {
        try {
          const dropdown = this.page.locator(selector).first();
          const isVisible = await dropdown.isVisible({ timeout: 2000 }).catch(() => false);

          if (isVisible) {
            // Check if it's a select element
            const tagName = await dropdown.evaluate(el => el.tagName.toLowerCase());

            if (tagName === 'select') {
              // Use selectOption for native select
              await dropdown.selectOption('50');
              console.log('✅ Selected 50 from dropdown (select)');
              dropdownFound = true;
              break;
            } else {
              // Click the dropdown to open it
              await dropdown.click();
              await this.page.waitForTimeout(500);

              // Click on 50 option
              const option50 = this.page.locator('li:has-text("50"), option:has-text("50"), div:has-text("50")').first();
              const optionVisible = await option50.isVisible({ timeout: 2000 }).catch(() => false);

              if (optionVisible) {
                await option50.click();
                console.log('✅ Selected 50 from dropdown (custom)');
                dropdownFound = true;
                break;
              }
            }
          }
        } catch (err) {
          // Continue to next selector
        }
      }

      if (!dropdownFound) {
        console.log('⚠️  Pagination dropdown not found, continuing with default...');
      }

      // Wait for table to reload with more rows
      console.log('⏳ Waiting for table to reload with more rows...');
      await this.page.waitForTimeout(8000);

    } catch (error) {
      console.log(`⚠️  Could not change pagination: ${error.message}`);
    }
  }

  /**
   * Download all POs by iterating through table rows
   */
  async downloadAllPOs() {
    console.log('\n🔍 Looking for PO table rows...');

    const downloadedFiles = [];

    // Wait for the table data to be fully loaded with retry
    let rowCount = 0;
    let rowSelector = 'div[role="row"]'; // default for this app
    const maxRetries = 5;

    for (let retry = 0; retry < maxRetries; retry++) {
      console.log(`⏳ Waiting for table data to load (attempt ${retry + 1}/${maxRetries})...`);
      await this.page.waitForTimeout(5000);

      // Check row count with primary selector
      rowCount = await this.page.locator(rowSelector).count();
      console.log(`   Found ${rowCount} rows with "${rowSelector}"`);

      // If we have a reasonable number of rows, proceed
      if (rowCount > 10) {
        console.log('   ✅ Table data loaded');
        break;
      }

      // Try other selectors
      const rowSelectors = [
        'div[role="row"]',
        'table tbody tr',
        '[class*="table"] [class*="row"]'
      ];

      for (const selector of rowSelectors) {
        const count = await this.page.locator(selector).count();
        if (count > rowCount) {
          rowCount = count;
          rowSelector = selector;
          console.log(`   Switching to selector "${selector}" with ${count} rows`);
        }
      }

      if (retry < maxRetries - 1 && rowCount < 10) {
        console.log('   ⏳ Not enough rows yet, waiting longer...');
      }
    }

    console.log(`   Using selector: "${rowSelector}" with ${rowCount} rows`);

    // Skip first row if it's a header row (for div[role="row"])
    let startIndex = 0;
    if (rowSelector === 'div[role="row"]' && rowCount > 0) {
      // Check if first row is a header
      const firstRow = this.page.locator(rowSelector).first();
      const isHeader = await firstRow.getAttribute('role') === 'row' &&
                       await firstRow.locator('[role="columnheader"]').count() > 0;
      if (isHeader) {
        startIndex = 1;
        rowCount = rowCount - 1;
        console.log(`   Skipping header row, ${rowCount} data rows to process`);
      }
    }

    if (rowCount === 0) {
      console.log('⚠️  No PO rows found in the table');
      return downloadedFiles;
    }

    // Limit to N orders if maxOrders is set, otherwise download all
    const actualRowCount = this.maxOrders > 0 ? Math.min(rowCount, this.maxOrders) : rowCount;
    console.log(`📊 Found ${rowCount} PO(s), downloading ${actualRowCount}\n`);

    // Download each PO by clicking the Download button in each row
    const totalRows = actualRowCount;
    for (let i = 0; i < totalRows; i++) {
      const rowIndex = startIndex + i;
      console.log(`📥 Downloading PO ${i + 1}/${totalRows}...`);

      try {
        // Get the row
        const row = this.page.locator(rowSelector).nth(rowIndex);

        // Find the Download button in this row's action column
        // Try multiple selectors for the download button
        let downloadBtn = null;
        const buttonSelectors = [
          'button:has-text("Download")',
          'a:has-text("Download")',
          '[role="button"]:has-text("Download")',
          'text=Download',
          'span:has-text("Download")',
          'div:has-text("Download")',
          'button[title*="download" i]',
          'a[title*="download" i]',
          '[class*="download" i]'
        ];

        for (const selector of buttonSelectors) {
          try {
            const btn = row.locator(selector).first();
            const isVisible = await btn.isVisible({ timeout: 500 }).catch(() => false);
            if (isVisible) {
              downloadBtn = btn;
              console.log(`   Found button with selector: ${selector}`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        if (!downloadBtn) {
          // Try to find any clickable element with "Download" text in the row
          const allElements = await row.locator('*').all();
          for (const el of allElements) {
            const text = await el.textContent().catch(() => '');
            if (text && text.trim().toLowerCase() === 'download') {
              downloadBtn = el;
              console.log(`   Found button via text search`);
              break;
            }
          }
        }

        if (!downloadBtn) {
          console.log(`⚠️  No Download button found in row ${i + 1}, skipping...`);
          continue;
        }

        // Set up download listener before clicking
        const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });

        // Click the download button
        await downloadBtn.click();

        // Wait for download to complete
        const download = await downloadPromise;

        // Get the suggested filename or generate one
        let filename = download.suggestedFilename();
        if (!filename) {
          filename = `flipkart_po_${i + 1}_${Date.now()}.xls`;
        }

        // Save to temp directory
        const filepath = path.join(this.tempDir, filename);
        await download.saveAs(filepath);

        downloadedFiles.push(filepath);
        console.log(`✅ Downloaded: ${filename}`);

        // Brief pause between downloads
        await this.page.waitForTimeout(1500);

      } catch (error) {
        console.error(`❌ Error downloading PO ${i + 1}: ${error.message}`);
      }
    }

    console.log(`\n📊 Downloaded ${downloadedFiles.length}/${totalRows} file(s)`);
    return downloadedFiles;
  }

  /**
   * Find all download buttons on the page
   */
  async findDownloadButtons() {
    console.log('🔍 Searching for Download buttons...');

    // Primary approach: Use Playwright locator for "Download" text buttons
    try {
      const downloadLocator = this.page.locator('button:has-text("Download"), a:has-text("Download"), [role="button"]:has-text("Download")');
      const count = await downloadLocator.count();

      if (count > 0) {
        console.log(`   Found ${count} Download button(s) via locator`);
        const buttons = await downloadLocator.all();
        return buttons;
      }
    } catch (err) {
      console.log('   Locator approach failed, trying fallback...');
    }

    // Fallback: Search all elements for "Download" text
    const buttons = [];
    try {
      const elements = await this.page.$$('button, a, [role="button"], span');
      for (const element of elements) {
        const text = await element.textContent().catch(() => '');
        if (text && text.trim().toLowerCase() === 'download') {
          buttons.push(element);
        }
      }
      if (buttons.length > 0) {
        console.log(`   Found ${buttons.length} Download button(s) via element search`);
      }
    } catch (err) {
      // Continue
    }

    // Additional fallback: Look for download icons/buttons by class
    try {
      const iconButtons = await this.page.$$('[class*="download"], [class*="Download"], [data-testid*="download"]');
      for (const btn of iconButtons) {
        if (!buttons.includes(btn)) {
          buttons.push(btn);
        }
      }
    } catch (err) {
      // Continue
    }

    // Approach 3: Look for links with .xls extension
    try {
      const xlsLinks = await this.page.$$('a[href*=".xls"], a[href*=".xlsx"]');
      for (const link of xlsLinks) {
        if (!buttons.includes(link)) {
          buttons.push(link);
        }
      }
    } catch (err) {
      // Continue
    }

    return buttons;
  }

  /**
   * Download a single PO file
   */
  async downloadSinglePO(button, index) {
    try {
      // Set up download listener before clicking
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });

      // Click the download button
      await button.click();

      // Wait for download to start
      const download = await downloadPromise;

      // Get the suggested filename or generate one
      let filename = download.suggestedFilename();
      if (!filename) {
        filename = `flipkart_po_${index}_${Date.now()}.xls`;
      }

      // Save to temp directory
      const filepath = path.join(this.tempDir, filename);
      await download.saveAs(filepath);

      return filepath;
    } catch (error) {
      // If download event times out, the button might not trigger a download
      console.log(`⚠️  Download ${index} did not trigger file download`);
      return null;
    }
  }

  /**
   * Flatten and combine all downloaded files into one
   */
  async combineFiles(downloadedFiles) {
    console.log('\n📊 Flattening and combining downloaded files...');

    const outputFilename = generateMergedFilename('filflo_flipkart_po', '.xlsx');
    const outputPath = path.join(this.downloadPath, outputFilename);

    // Use flattenAndMergePoFiles to handle PO-specific flattening
    const combinedFile = flattenAndMergePoFiles(downloadedFiles, outputPath);
    return combinedFile;
  }

  /**
   * Cleanup temporary files
   */
  cleanupTempFiles(files) {
    console.log('\n🧹 Cleaning up temporary files...');

    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        console.log(`⚠️  Could not delete temp file: ${path.basename(file)}`);
      }
    }

    // Remove temp directory
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmdirSync(this.tempDir);
      }
    } catch (err) {
      // Directory not empty or other error - ignore
    }

    console.log('✅ Cleanup completed');
  }
}
