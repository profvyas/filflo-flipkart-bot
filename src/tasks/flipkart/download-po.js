/**
 * Flipkart Vendor Hub Download PO Task
 * Downloads all available POs and combines them into a single XLS file
 */

import { BaseTask } from '../../core/BaseTask.js';
import { mergeXlsFiles, generateMergedFilename, flattenAndMergePoFiles } from '../../utils/xls-merger.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { parse } from 'csv-parse/sync';

export class FlipkartDownloadPOTask extends BaseTask {
  constructor(taskConfig) {
    super(taskConfig);
    this.downloadPath = taskConfig.downloadPath || './downloads/flipkart';
    this.tempDir = path.join(os.tmpdir(), 'flipkart-po-downloads-' + Date.now());
    this.maxOrders = taskConfig.maxOrders || 0; // 0 = all orders
  }

  /**
   * Get the PO number from the first data row of the table
   * Used to verify page content actually changed after pagination
   * @returns {string|null} PO number or null if not found
   */
  async getFirstRowPONumber() {
    try {
      const firstDataRow = this.page.locator('div[role="row"]').nth(1); // Skip header
      const rowText = await firstDataRow.textContent();
      // Extract PO number pattern like "FLGWN07529757" (2-5 letters + 8 digits)
      const poMatch = rowText.match(/[A-Z]{2,5}\d{8}/);
      return poMatch ? poMatch[0] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Main download flow
   */
  async run() {
    console.log('\n📋 Starting Flipkart PO Download...\n');

    // Ensure download directories exist
    this.ensureDirectoriesExist();

    // Define statuses to process
    const statuses = [
      {
        status: 'open',
        label: 'Open',
        url: 'https://vendorhub.flipkart.com/#/operations/po/list?status=open'
      },
      {
        status: 'pending_acknowledgement',
        label: 'Pending Ack',
        url: 'https://vendorhub.flipkart.com/#/operations/po/list?status=pending_acknowledgement'
      }
    ];

    const allDownloadedFiles = []; // Array of { path, orderStatus }
    let combinedWarehouseMap = new Map();
    const allCsvPaths = [];

    // Process each status page
    for (const statusConfig of statuses) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📂 Processing "${statusConfig.label}" POs...`);
      console.log(`${'='.repeat(60)}`);

      const { files, warehouseMap, csvPath } = await this.downloadPOsForStatus(statusConfig);

      // Accumulate files with status info
      allDownloadedFiles.push(...files);

      // Merge warehouse mappings
      for (const [key, value] of warehouseMap) {
        combinedWarehouseMap.set(key, value);
      }

      // Track CSV for cleanup
      if (csvPath) {
        allCsvPaths.push(csvPath);
      }

      console.log(`\n✅ Completed "${statusConfig.label}": ${files.length} file(s)`);
    }

    if (allDownloadedFiles.length === 0) {
      console.log('\n⚠️  No PO files were downloaded from any status page');
      return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Combining all ${allDownloadedFiles.length} PO files...`);
    console.log(`${'='.repeat(60)}`);

    // Flatten and combine all downloaded files
    const combinedFile = await this.combineFiles(allDownloadedFiles, combinedWarehouseMap);

    // Cleanup temp files (including CSVs)
    const filesToCleanup = [...allDownloadedFiles.map(f => f.path), ...allCsvPaths];
    this.cleanupTempFiles(filesToCleanup);

    console.log(`\n✅ Flipkart PO download completed!`);
    console.log(`📁 Combined file saved: ${combinedFile}\n`);
  }

  /**
   * Download POs for a specific status page
   * @param {Object} statusConfig - { status, label, url }
   * @returns {Object} { files: Array<{path, orderStatus}>, warehouseMap: Map, csvPath: string|null }
   */
  async downloadPOsForStatus(statusConfig) {
    const { label, url } = statusConfig;

    // Navigate to status-specific PO list page
    await this.navigateToPOList(url);

    // Download PO List CSV for warehouse mapping
    const csvPath = await this.downloadPOListCSV();
    let warehouseMap = new Map();
    if (csvPath) {
      warehouseMap = this.parseWarehouseMapping(csvPath);
    }

    // Set pagination to 50 POs per page
    await this.setPaginationTo50();

    // Download all PO files from this status page
    // Pass status to use appropriate download strategy (direct button vs kebab menu)
    const downloadedPaths = await this.downloadAllPOsAcrossPages(statusConfig.status);

    // Convert paths to file info objects with orderStatus
    const files = downloadedPaths.map(filePath => ({
      path: filePath,
      orderStatus: label
    }));

    return { files, warehouseMap, csvPath };
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
   * @param {string} url - The URL to navigate to
   */
  async navigateToPOList(url) {
    console.log(`🌐 Navigating to PO list page: ${url}`);
    await this.navigateTo(url);
    console.log('⏳ Waiting for PO data to load...');
    await this.page.waitForTimeout(5000); // Wait for data to load
    console.log('✅ PO list page loaded');
  }

  /**
   * Download the PO List CSV file (contains Origin Warehouse info)
   * @returns {string|null} Path to downloaded CSV file, or null if failed
   */
  async downloadPOListCSV() {
    console.log('\n📥 Downloading PO List CSV for warehouse mapping...');

    try {
      // Look for the "Download List" button
      const downloadListSelectors = [
        'button:has-text("Download List")',
        'text=Download List',
        '[role="button"]:has-text("Download List")',
        'a:has-text("Download List")'
      ];

      let downloadBtn = null;
      for (const selector of downloadListSelectors) {
        try {
          const btn = this.page.locator(selector).first();
          const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVisible) {
            downloadBtn = btn;
            console.log(`   Found "Download List" button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!downloadBtn) {
        console.log('⚠️  "Download List" button not found, skipping warehouse mapping');
        return null;
      }

      // Set up download listener before clicking
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });

      // Click the download button
      await downloadBtn.click();
      console.log('   ⏳ Waiting for CSV download...');

      // Wait for download to complete
      const download = await downloadPromise;

      // Get the suggested filename or generate one
      let filename = download.suggestedFilename();
      if (!filename) {
        filename = `po_list_${Date.now()}.csv`;
      }

      // Save to temp directory
      const filepath = path.join(this.tempDir, filename);
      await download.saveAs(filepath);

      console.log(`   ✅ Downloaded: ${filename}`);
      return filepath;
    } catch (error) {
      console.log(`⚠️  Error downloading PO List CSV: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse warehouse mapping from the downloaded CSV
   * @param {string} csvPath - Path to the CSV file
   * @returns {Map<string, string>} Map of PO_Number → Origin_Warehouse
   */
  parseWarehouseMapping(csvPath) {
    console.log('\n📊 Parsing warehouse mapping from CSV...');

    try {
      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
      });

      const warehouseMap = new Map();

      for (const record of records) {
        // Column names may vary, try common variations
        const poNumber = record['Purchase Order ID'] || record['PO ID'] || record['PO Number'] || '';
        const originWarehouse = record['Origin Warehouse'] || record['Warehouse'] || '';

        if (poNumber && originWarehouse) {
          warehouseMap.set(poNumber, originWarehouse);
        }
      }

      console.log(`   ✅ Loaded ${warehouseMap.size} PO → Warehouse mappings`);
      return warehouseMap;
    } catch (error) {
      console.log(`⚠️  Error parsing warehouse CSV: ${error.message}`);
      return new Map();
    }
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
   * Click "Next" button and wait for table content to actually change
   * @returns {boolean} True if navigation succeeded and content changed
   */
  async goToNextPage() {
    console.log('\n📄 Navigating to next page...');

    // Get current page number from pagination text
    const getCurrentPage = async () => {
      try {
        const pageText = await this.page.locator('text=/\\d+ of \\d+ pages/i').first().textContent();
        const match = pageText.match(/(\d+)\s+of\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
      } catch (e) {
        return null;
      }
    };

    // Capture first row PO number and current page before clicking
    const poBefore = await this.getFirstRowPONumber();
    const pageBefore = await getCurrentPage();
    console.log(`   Current first PO: ${poBefore || 'unknown'}, Page: ${pageBefore || 'unknown'}`);

    // Helper to verify content actually changed after clicking
    const verifyContentChanged = async () => {
      for (let i = 0; i < 10; i++) {
        await this.page.waitForTimeout(1000);

        // Check if page number changed
        const pageAfter = await getCurrentPage();
        if (pageAfter && pageBefore && pageAfter > pageBefore) {
          console.log(`   ✅ Page changed: ${pageBefore} → ${pageAfter}`);
          return true;
        }

        // Also check if first PO changed
        const poAfter = await this.getFirstRowPONumber();
        if (poAfter && poBefore && poAfter !== poBefore) {
          console.log(`   ✅ Content changed: ${poBefore} → ${poAfter}`);
          return true;
        }
      }
      console.log('   ⚠️ Page content did not change after 10 seconds');
      return false;
    };

    // Approach 1: Use Playwright's text locator for ">" button
    try {
      // Try multiple selectors for the next button
      const nextSelectors = [
        'button:has-text(">")',           // Button containing >
        'span:text-is(">")',              // Span with exact >
        'div:text-is(">")',               // Div with exact >
        '[role="button"]:has-text(">")',  // Role button containing >
      ];

      for (const selector of nextSelectors) {
        const btn = this.page.locator(selector).first();
        const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);

        if (isVisible) {
          const isDisabled = await btn.evaluate(node => {
            return node.disabled ||
                   node.classList.contains('disabled') ||
                   node.getAttribute('aria-disabled') === 'true' ||
                   node.style.opacity === '0.5';
          }).catch(() => false);

          if (!isDisabled) {
            console.log(`   Found ">" via "${selector}", clicking...`);
            await btn.click();
            console.log('   ⏳ Waiting for page content to change...');
            return await verifyContentChanged();
          } else {
            console.log(`   Found ">" via "${selector}" but it's disabled`);
          }
        }
      }
      console.log('   No ">" button found via text selectors');
    } catch (e) {
      console.log(`   ">" button search error: ${e.message}`);
    }

    // Approach 2: Find the "angle-right" SVG icon and click its parent container
    try {
      // Look for SVG with icon="angle-right" attribute
      const nextSvg = this.page.locator('svg[icon="angle-right"]').first();
      const isVisible = await nextSvg.isVisible({ timeout: 2000 }).catch(() => false);

      if (isVisible) {
        // Check if it's disabled
        const isDisabled = await nextSvg.getAttribute('disabled');
        if (isDisabled === null || isDisabled === undefined) {
          // Click the parent div container (the actual clickable element)
          const parentDiv = nextSvg.locator('xpath=ancestor::div[1]').first();
          console.log('   Found angle-right SVG, clicking parent container...');
          await parentDiv.scrollIntoViewIfNeeded();
          await parentDiv.click({ force: true });
          console.log('   ⏳ Waiting for page content to change...');
          return await verifyContentChanged();
        } else {
          console.log('   angle-right SVG is disabled (last page)');
        }
      }
    } catch (e) {
      console.log(`   angle-right SVG search error: ${e.message}`);
    }

    // Approach 2b: Find pagination controls by inspecting DOM near "X of Y pages"
    try {
      // Look for the pagination text "X of Y pages"
      const paginationText = this.page.locator('text=/\\d+ of \\d+ pages/i').first();
      const isVisible = await paginationText.isVisible({ timeout: 2000 }).catch(() => false);

      if (isVisible) {
        // Go up to a reasonable parent container
        const grandParent = paginationText.locator('xpath=ancestor::div[3]').first();

        // Try to find SVG elements (likely the arrow icons)
        const svgs = grandParent.locator('svg');
        const svgCount = await svgs.count();
        console.log(`   Found ${svgCount} SVG elements in pagination area`);

        // The last SVG is likely the ">" next button
        if (svgCount >= 2) {
          const nextSvg = svgs.last();

          // Check if disabled
          const isDisabled = await nextSvg.getAttribute('disabled');
          if (isDisabled === null || isDisabled === undefined) {
            console.log('   Clicking on last SVG (next button)...');
            await nextSvg.scrollIntoViewIfNeeded();
            await nextSvg.click({ force: true });
            console.log('   ⏳ Waiting for page content to change...');
            return await verifyContentChanged();
          } else {
            console.log('   Last SVG is disabled');
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
        console.log('   ⏳ Waiting for page content to change...');
        return await verifyContentChanged();
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
            console.log('   ⏳ Waiting for page content to change...');
            return await verifyContentChanged();
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
   * @param {string} status - The PO status page type ('open' or 'pending_acknowledgement')
   * @returns {string[]} Array of downloaded file paths
   */
  async downloadAllPOsAcrossPages(status = 'open') {
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
        remainingToDownload,
        status
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

      // Navigate to next page (verifies content actually changed)
      const navigated = await this.goToNextPage();
      if (!navigated) {
        console.log('⚠️  Page navigation failed or content unchanged, stopping pagination');
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
   * @param {string} status - The PO status page type ('open' or 'pending_acknowledgement')
   * @returns {{ downloadedFiles: string[], downloadedCount: number }}
   */
  async downloadPOsFromCurrentPage(totalDownloadedSoFar = 0, remainingToDownload = Infinity, status = 'open') {
    console.log('\n🔍 Looking for PO table rows...');

    const downloadedFiles = [];

    // Wait for the table data to be fully loaded with retry
    let rowCount = 0;
    let rowSelector = 'div[role="row"]'; // default for this app
    const maxRetries = 5;

    for (let retry = 0; retry < maxRetries; retry++) {
      console.log(`⏳ Waiting for table data to load (attempt ${retry + 1}/${maxRetries})...`);
      await this.page.waitForTimeout(3000);

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

        // Find the Download button - strategy depends on status page type
        let downloadBtn = null;

        if (status === 'pending_acknowledgement') {
          // For pending ack: click kebab menu first, then find Download in dropdown
          downloadBtn = await this.findDownloadInKebabMenu(row);
        } else {
          // For open: use direct Download button
          downloadBtn = await this.findDirectDownloadButton(row);
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
        await this.page.waitForTimeout(1000);

      } catch (error) {
        console.error(`❌ Error downloading PO ${i + 1}: ${error.message}`);
      }
    }

    console.log(`\n📊 Downloaded ${downloadedFiles.length}/${totalRows} file(s) from this page`);
    return { downloadedFiles, downloadedCount: downloadedFiles.length };
  }

  /**
   * Find direct Download button within a row (used for "Open" status POs)
   * @param {Locator} row - The row locator
   * @returns {Locator|null} The download button locator or null if not found
   */
  async findDirectDownloadButton(row) {
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
          console.log(`   Found Download button`);
          return btn;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Fallback: Try to find any clickable element with "Download" text in the row
    try {
      const allElements = await row.locator('*').all();
      for (const el of allElements) {
        const text = await el.textContent().catch(() => '');
        if (text && text.trim().toLowerCase() === 'download') {
          console.log(`   Found Download button`);
          return el;
        }
      }
    } catch (e) {
      // Continue
    }

    return null;
  }

  /**
   * Find Download option in kebab/three-dots menu (used for "Pending Acknowledgement" status POs)
   * For these POs, the Download button is hidden in a dropdown menu accessed via ":" button
   * @param {Locator} row - The row locator
   * @returns {Locator|null} The download option locator or null if not found
   */
  async findDownloadInKebabMenu(row) {
    // Try to find the kebab menu button (three-dots/vertical ellipsis icon)
    // On Flipkart Vendor Hub, it's an SVG with icon="more-v" inside a clickable div
    const kebabSelectors = [
      'svg[icon="more-v"]',                      // SVG with more-v icon attribute
      '[class*="ActionStyles__Icon"]',           // Action icon class
      'div:has(> svg[icon="more-v"])',           // Div containing more-v SVG
      'button:has-text(":")',                    // Button with : text
      'button:has-text("⋮")',                    // Vertical ellipsis
      '[aria-label*="more" i]',                  // Aria label for more options
      '[aria-label*="options" i]',               // Aria label for options
      '[aria-label*="menu" i]',                  // Aria label for menu
      '[class*="kebab" i]',                      // Class containing kebab
      '[class*="overflow" i]',                   // Class containing overflow
      'button:has(svg):not(:has-text("Acknowledge"))'  // Button with SVG (icon) that's not Acknowledge
    ];

    let kebabBtn = null;
    for (const selector of kebabSelectors) {
      try {
        // Get all matching elements in the row and take the last one
        // (kebab is usually after other action buttons)
        const btns = row.locator(selector);
        const count = await btns.count();
        if (count > 0) {
          let btn = btns.last();
          const isVisible = await btn.isVisible({ timeout: 500 }).catch(() => false);
          if (isVisible) {
            // If we found an SVG, get its parent div which is the clickable element
            const tagName = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
            if (tagName === 'svg') {
              btn = btn.locator('xpath=..');  // Get parent element
            }
            kebabBtn = btn;
            console.log(`   Found kebab menu`);
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!kebabBtn) {
      // Fallback: Try finding any button in the row that's not Acknowledge
      try {
        const buttons = row.locator('button');
        const count = await buttons.count();

        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          const text = await btn.textContent().catch(() => '');

          // Skip Acknowledge button, look for short/empty text buttons (likely icons)
          const trimmedText = text?.trim() || '';
          if (!trimmedText.toLowerCase().includes('acknowledge') &&
              !trimmedText.toLowerCase().includes('download') &&
              trimmedText.length <= 5) {
            const isVisible = await btn.isVisible({ timeout: 300 }).catch(() => false);
            if (isVisible) {
              kebabBtn = btn;
              break;
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // Also try looking for div or span elements that might be clickable menu triggers
    if (!kebabBtn) {
      try {
        const clickables = row.locator('div[role="button"], span[role="button"], [class*="click"]');
        const count = await clickables.count();
        for (let i = 0; i < count; i++) {
          const el = clickables.nth(i);
          const text = await el.textContent().catch(() => '');
          if (!text || text.trim().length <= 3) {
            const isVisible = await el.isVisible({ timeout: 300 }).catch(() => false);
            if (isVisible) {
              kebabBtn = el;
              console.log(`   Found clickable element as kebab at index ${i}`);
              break;
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }

    if (!kebabBtn) {
      console.log(`   Could not find kebab menu in row`);
      return null;
    }

    // Click kebab button to open dropdown menu
    try {
      await kebabBtn.click();
      console.log(`   Clicked kebab menu, waiting for dropdown...`);
      await this.page.waitForTimeout(500);

      // Wait for dropdown/popover to appear
      // Flipkart uses a popover/portal that appears in the DOM
      const dropdownSelectors = [
        '[class*="Popover"]',
        '[class*="popover"]',
        '[class*="Dropdown"]',
        '[class*="dropdown"]',
        '[class*="Menu"]:not([class*="MenuBar"])',
        '[role="menu"]',
        '[role="listbox"]'
      ];

      let dropdown = null;
      for (const selector of dropdownSelectors) {
        try {
          const el = this.page.locator(selector).last();
          const isVisible = await el.isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            dropdown = el;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      // Find "Download" option - prefer within dropdown, fallback to page-level
      let downloadOption = null;

      if (dropdown) {
        // Look for Download within the dropdown
        const downloadInDropdown = dropdown.locator('text=Download').first();
        const isVisible = await downloadInDropdown.isVisible({ timeout: 500 }).catch(() => false);
        if (isVisible) {
          downloadOption = downloadInDropdown;
        }
      }

      // Fallback: Look for any visible Download text that's NOT the "Download List" button
      if (!downloadOption) {
        const allDownloads = this.page.locator('text=Download');
        const count = await allDownloads.count();

        for (let i = 0; i < count; i++) {
          const el = allDownloads.nth(i);
          const text = await el.textContent().catch(() => '');
          const isVisible = await el.isVisible({ timeout: 200 }).catch(() => false);

          // Skip "Download List" button, we want just "Download"
          if (isVisible && text && text.trim() === 'Download') {
            downloadOption = el;
            break;
          }
        }
      }

      if (downloadOption) {
        console.log(`   Found Download in menu`);
        return downloadOption;
      }

      // If no Download found, close the dropdown
      console.log(`   Download option not found in menu, closing...`);
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);

    } catch (e) {
      console.log(`   Error opening kebab menu: ${e.message}`);
    }

    return null;
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
   * @param {Array<{path: string, orderStatus: string}>} downloadedFiles - Array of file info objects
   * @param {Map<string, string>} warehouseMapping - Map of PO_Number → Origin_Warehouse
   */
  async combineFiles(downloadedFiles, warehouseMapping = new Map()) {
    console.log('\n📊 Flattening and combining downloaded files...');

    const outputFilename = generateMergedFilename('filflo_flipkart_po', '.xlsx');
    const outputPath = path.join(this.downloadPath, outputFilename);

    // Use flattenAndMergePoFiles to handle PO-specific flattening
    // Pass file info objects with path and orderStatus
    const combinedFile = flattenAndMergePoFiles(downloadedFiles, outputPath, warehouseMapping);
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
