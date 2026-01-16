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
    // await this.setPaginationTo50();  // Skip for testing pagination with default 10 items

    // Step 3: Download all individual PO files from each row (across all pages)
    const downloadedFiles = await this.downloadAllPOsAcrossPages();

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
   * Extract total PO count from pagination info (e.g., "Showing 1-50 of 234")
   * @returns {number} Total count or 0 if not found
   */
  async getTotalPOCount() {
    try {
      // Look for pagination info text patterns
      const paginationInfoSelectors = [
        'text=/Showing \\d+-\\d+ of \\d+/i',
        'text=/\\d+-\\d+ of \\d+/',
        '[class*="page-info"]',
        '[class*="pagination-info"]',
        '[class*="showing"]'
      ];

      for (const selector of paginationInfoSelectors) {
        try {
          const element = this.page.locator(selector).first();
          const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false);

          if (isVisible) {
            const text = await element.textContent();
            // Extract "of X" where X is the total count
            const match = text.match(/of\s+(\d+)/i);
            if (match) {
              const total = parseInt(match[1], 10);
              console.log(`📊 Total PO count from pagination: ${total}`);
              return total;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Fallback: try to find any element containing the pattern
      const allText = await this.page.locator('body').textContent();
      const match = allText.match(/Showing\s+\d+-\d+\s+of\s+(\d+)/i);
      if (match) {
        const total = parseInt(match[1], 10);
        console.log(`📊 Total PO count from page text: ${total}`);
        return total;
      }

      console.log('⚠️  Could not determine total PO count from pagination');
      return 0;
    } catch (error) {
      console.log(`⚠️  Error getting total PO count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Check if "Next" page button exists and is enabled
   * @returns {boolean} True if next page is available
   */
  async hasNextPage() {
    console.log('🔍 Checking for next page...');

    // First, try to find pagination info to determine if more pages exist
    try {
      const paginationText = await this.page.locator('body').textContent();

      // Look for "X of Y pages" pattern (Flipkart format)
      const pagesMatch = paginationText.match(/(\d+)\s+of\s+(\d+)\s+pages/i);
      if (pagesMatch) {
        const currentPage = parseInt(pagesMatch[1], 10);
        const totalPages = parseInt(pagesMatch[2], 10);
        console.log(`   Pagination: ${currentPage} of ${totalPages} pages`);
        if (currentPage < totalPages) {
          console.log('   ✅ More pages available');
          return true;
        } else {
          console.log('   ℹ️  On last page');
          return false;
        }
      }

      // Look for patterns like "1-50 of 234"
      const rangeMatch = paginationText.match(/(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i);
      if (rangeMatch) {
        const endItem = parseInt(rangeMatch[2], 10);
        const totalItems = parseInt(rangeMatch[3], 10);
        console.log(`   Pagination info: showing up to ${endItem} of ${totalItems}`);
        if (endItem < totalItems) {
          console.log('   ✅ More items available');
          return true;
        } else {
          console.log('   ℹ️  All items shown on current page');
          return false;
        }
      }

      // Look for "Page X of Y" pattern
      const pageMatch = paginationText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
      if (pageMatch) {
        const currentPage = parseInt(pageMatch[1], 10);
        const totalPages = parseInt(pageMatch[2], 10);
        console.log(`   Page ${currentPage} of ${totalPages}`);
        if (currentPage < totalPages) {
          console.log('   ✅ More pages available');
          return true;
        }
      }
    } catch (e) {
      console.log('   Could not parse pagination text');
    }

    // Fallback: Try to find next button
    const nextButtonSelectors = [
      'button:has-text("Next")',
      '[aria-label="Next page"]',
      '[aria-label="next page"]',
      '[aria-label="Go to next page"]',
      '[class*="pagination"] [class*="next"]:not([disabled])',
      'button[class*="next"]:not([disabled])',
      '[class*="page-next"]:not([disabled])',
      'a:has-text("Next")',
      'li.next:not(.disabled) a',
      '[class*="pagination"] button:has-text(">")',
      'button:has-text(">")',
      'button:has-text(">>")',
      'button:has-text("→")',
      '[class*="chevron-right"]',
      '[class*="arrow-right"]',
      'svg[class*="right"]',
      'button svg[data-testid*="right"]',
      '[data-testid*="next"]',
      '[data-testid*="pagination"] button:last-child'
    ];

    for (const selector of nextButtonSelectors) {
      try {
        const button = this.page.locator(selector).first();
        const isVisible = await button.isVisible({ timeout: 500 }).catch(() => false);

        if (isVisible) {
          // Check if button is disabled
          const isDisabled = await button.evaluate(el => {
            return el.disabled ||
                   el.classList.contains('disabled') ||
                   el.getAttribute('aria-disabled') === 'true' ||
                   el.parentElement?.classList.contains('disabled') ||
                   el.style.opacity === '0.5' ||
                   el.style.pointerEvents === 'none';
          }).catch(() => false);

          if (!isDisabled) {
            console.log(`   ✅ Found enabled next button: ${selector}`);
            return true;
          } else {
            console.log(`   ℹ️  Found disabled next button: ${selector}`);
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    console.log('   ℹ️  No next page button found');
    return false;
  }

  /**
   * Click "Next" button and wait for table to reload
   * @returns {boolean} True if navigation succeeded
   */
  async goToNextPage() {
    console.log('\n📄 Navigating to next page...');

    // Approach 1: Find buttons near "of X pages" text that look like navigation
    try {
      // Get all buttons and check their position/content
      const allButtons = await this.page.$$('button');
      console.log(`   Found ${allButtons.length} buttons on page`);

      for (const btn of allButtons) {
        const text = await btn.textContent().catch(() => '');
        const trimmed = text.trim();
        const innerHTML = await btn.evaluate(el => el.innerHTML).catch(() => '');

        // Match ">" or "›" or contains chevron/arrow SVG
        const isNextButton =
          trimmed === '>' ||
          trimmed === '›' ||
          trimmed === '»' ||
          trimmed === '→' ||
          innerHTML.includes('chevron') ||
          innerHTML.includes('arrow') ||
          innerHTML.includes('right') ||
          innerHTML.includes('next');

        if (isNextButton) {
          const isDisabled = await btn.evaluate(el => {
            return el.disabled ||
                   el.classList.contains('disabled') ||
                   el.getAttribute('aria-disabled') === 'true';
          }).catch(() => false);

          if (!isDisabled) {
            console.log(`   Found next button (text: "${trimmed}"), clicking...`);
            await btn.click();
            console.log('   ⏳ Waiting for next page to load...');
            await this.page.waitForTimeout(5000);
            console.log('   ✅ Navigated to next page');
            return true;
          }
        }
      }
    } catch (e) {
      console.log(`   Button search error: ${e.message}`);
    }

    // Approach 2: Find by position - button after the page number display
    try {
      // Look for the pagination container and find the last button (usually "next")
      const paginationArea = this.page.locator('text=/of \\d+ pages/i').first();
      const isVisible = await paginationArea.isVisible({ timeout: 2000 }).catch(() => false);

      if (isVisible) {
        // Get parent container and find buttons within it
        const parent = paginationArea.locator('xpath=ancestor::div[contains(@class, "pagination") or contains(@class, "pager") or .//button]').first();
        const buttons = parent.locator('button');
        const count = await buttons.count();
        console.log(`   Found ${count} buttons in pagination area`);

        if (count >= 2) {
          // Usually the last button is "next"
          const nextBtn = buttons.last();
          const isDisabled = await nextBtn.evaluate(el => el.disabled).catch(() => false);

          if (!isDisabled) {
            console.log('   Clicking last pagination button (next)...');
            await nextBtn.click();
            console.log('   ⏳ Waiting for next page to load...');
            await this.page.waitForTimeout(5000);
            console.log('   ✅ Navigated to next page');
            return true;
          }
        }
      }
    } catch (e) {
      console.log(`   Pagination area search error: ${e.message}`);
    }

    // Approach 3: Click directly on ">" text anywhere on page
    try {
      const nextArrow = this.page.locator('button >> text=">"').first();
      const isVisible = await nextArrow.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        console.log('   Found ">" via text locator, clicking...');
        await nextArrow.click();
        console.log('   ⏳ Waiting for next page to load...');
        await this.page.waitForTimeout(5000);
        console.log('   ✅ Navigated to next page');
        return true;
      }
    } catch (e) {
      // Continue
    }

    // Approach 4: Try various CSS selectors
    const nextButtonSelectors = [
      'button:has-text("Next")',
      '[aria-label="Next page"]',
      '[aria-label="next page"]',
      '[aria-label="Go to next page"]',
      '[class*="pagination"] button:last-of-type',
      '[class*="pager"] button:last-of-type'
    ];

    for (const selector of nextButtonSelectors) {
      try {
        const button = this.page.locator(selector).first();
        const isVisible = await button.isVisible({ timeout: 500 }).catch(() => false);

        if (isVisible) {
          const isDisabled = await button.evaluate(el => el.disabled).catch(() => false);

          if (!isDisabled) {
            console.log(`   Clicking: ${selector}`);
            await button.click();
            console.log('   ⏳ Waiting for next page to load...');
            await this.page.waitForTimeout(5000);
            console.log('   ✅ Navigated to next page');
            return true;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    console.log('⚠️  Could not find or click Next button');
    return false;
  }

  /**
   * Download all POs across all pages
   * @returns {string[]} Array of downloaded file paths
   */
  async downloadAllPOsAcrossPages() {
    console.log('\n🔄 Starting multi-page PO download...');

    const allDownloadedFiles = [];
    let totalDownloaded = 0;
    let currentPage = 1;
    const maxToDownload = this.maxOrders > 0 ? this.maxOrders : Infinity;

    // Get total count if available
    const totalPOCount = await this.getTotalPOCount();
    if (totalPOCount > 0) {
      const willDownload = this.maxOrders > 0 ? Math.min(totalPOCount, this.maxOrders) : totalPOCount;
      console.log(`📊 Planning to download ${willDownload} of ${totalPOCount} total PO(s)`);
    }

    // Loop through pages
    while (true) {
      console.log(`\n📄 Processing page ${currentPage}...`);

      // Calculate how many more we need to download
      const remainingToDownload = maxToDownload - totalDownloaded;

      if (remainingToDownload <= 0) {
        console.log(`✅ Reached maxOrders limit (${this.maxOrders})`);
        break;
      }

      // Download POs from current page
      const { downloadedFiles, downloadedCount } = await this.downloadPOsFromCurrentPage(
        totalDownloaded,
        remainingToDownload
      );

      allDownloadedFiles.push(...downloadedFiles);
      totalDownloaded += downloadedCount;

      console.log(`📊 Total downloaded so far: ${totalDownloaded}`);

      // Check if we've reached maxOrders
      if (this.maxOrders > 0 && totalDownloaded >= this.maxOrders) {
        console.log(`✅ Reached maxOrders limit (${this.maxOrders})`);
        break;
      }

      // Check if there's a next page
      const hasNext = await this.hasNextPage();
      if (!hasNext) {
        console.log('✅ No more pages available');
        break;
      }

      // Navigate to next page
      const navigated = await this.goToNextPage();
      if (!navigated) {
        console.log('⚠️  Could not navigate to next page, stopping pagination');
        break;
      }

      currentPage++;
    }

    console.log(`\n📊 Multi-page download complete: ${allDownloadedFiles.length} file(s) from ${currentPage} page(s)`);
    return allDownloadedFiles;
  }

  /**
   * Download POs from the current page
   * @param {number} totalDownloadedSoFar - Count of POs already downloaded from previous pages
   * @param {number} remainingToDownload - Maximum number to download from this page
   * @returns {{ downloadedFiles: string[], downloadedCount: number }}
   */
  async downloadPOsFromCurrentPage(totalDownloadedSoFar = 0, remainingToDownload = Infinity) {
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
      return { downloadedFiles: [], downloadedCount: 0 };
    }

    // Limit rows based on remainingToDownload parameter
    const actualRowCount = Math.min(rowCount, remainingToDownload);
    console.log(`📊 Found ${rowCount} PO(s) on this page, downloading ${actualRowCount}\n`);

    // Download each PO by clicking the Download button in each row
    const totalRows = actualRowCount;
    for (let i = 0; i < totalRows; i++) {
      const rowIndex = startIndex + i;
      const globalIndex = totalDownloadedSoFar + i + 1;
      console.log(`📥 Downloading PO ${globalIndex} (page row ${i + 1}/${totalRows})...`);

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
          filename = `flipkart_po_${globalIndex}_${Date.now()}.xls`;
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

    console.log(`\n📊 Downloaded ${downloadedFiles.length}/${totalRows} file(s) from this page`);
    return { downloadedFiles, downloadedCount: downloadedFiles.length };
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
