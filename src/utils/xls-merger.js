/**
 * XLS Merger Utility
 * Combines multiple XLS/XLSX files into a single file
 */

import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

/**
 * Merge multiple XLS/XLSX files into a single file
 * @param {string[]} filePaths - Array of file paths to merge
 * @param {string} outputPath - Path for the merged output file
 * @returns {string} Path to the merged file
 */
export function mergeXlsFiles(filePaths, outputPath) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('No files provided to merge');
  }

  console.log(`\n📊 Merging ${filePaths.length} XLS file(s)...`);

  const allData = [];
  let headers = null;
  let totalRows = 0;

  for (const filePath of filePaths) {
    try {
      console.log(`   📄 Reading: ${path.basename(filePath)}`);

      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (data.length === 0) {
        console.log(`   ⚠️  Empty file: ${path.basename(filePath)}`);
        continue;
      }

      // First file - capture headers
      if (!headers && data.length > 0) {
        headers = data[0];
        allData.push(headers);
      }

      // Add data rows (skip header if we already have headers)
      const dataRows = headers ? data.slice(1) : data;
      const nonEmptyRows = dataRows.filter(row => row.some(cell => cell !== undefined && cell !== ''));
      allData.push(...nonEmptyRows);
      totalRows += nonEmptyRows.length;

      console.log(`   ✅ Added ${nonEmptyRows.length} rows from ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`   ❌ Error reading ${path.basename(filePath)}: ${error.message}`);
    }
  }

  if (allData.length === 0) {
    throw new Error('No data found in any of the files');
  }

  // Create new workbook with merged data
  const newWorkbook = XLSX.utils.book_new();
  const newSheet = XLSX.utils.aoa_to_sheet(allData);
  XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Combined POs');

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write the merged file
  XLSX.writeFile(newWorkbook, outputPath);

  console.log(`\n✅ Merged file saved: ${outputPath}`);
  console.log(`   📊 Total rows: ${totalRows} (+ 1 header row)`);

  return outputPath;
}

/**
 * Generate a timestamped filename for merged files
 * @param {string} prefix - Filename prefix
 * @param {string} extension - File extension (default: .xlsx)
 * @returns {string} Timestamped filename
 */
export function generateMergedFilename(prefix = 'combined_po', extension = '.xlsx') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${timestamp}${extension}`;
}

/**
 * Flatten and merge PO XLS files into normalized structure
 * Each individual PO XLS may have:
 * - Header rows with PO info (PO ID, date, warehouse, etc.)
 * - Line item rows (SKU, product name, qty, price)
 *
 * This extracts PO header info and prepends it to each line item row
 * @param {string[]} filePaths - Array of file paths to merge
 * @param {string} outputPath - Path for the merged output file
 * @returns {string} Path to the merged file
 */
export function flattenAndMergePoFiles(filePaths, outputPath) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('No files provided to flatten and merge');
  }

  console.log(`\n📊 Flattening and merging ${filePaths.length} PO file(s)...`);

  const allRows = [];
  let outputHeaders = null;
  let totalRows = 0;

  for (const filePath of filePaths) {
    try {
      console.log(`   📄 Processing: ${path.basename(filePath)}`);

      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (data.length === 0) {
        console.log(`   ⚠️  Empty file: ${path.basename(filePath)}`);
        continue;
      }

      // Flatten this PO's data
      const { headers, rows } = flattenPoData(data);

      // First file with data - capture headers
      if (!outputHeaders && headers && headers.length > 0) {
        outputHeaders = headers;
        allRows.push(outputHeaders);
      }

      // Add flattened data rows
      if (rows && rows.length > 0) {
        allRows.push(...rows);
        totalRows += rows.length;
        console.log(`   ✅ Added ${rows.length} rows from ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.error(`   ❌ Error processing ${path.basename(filePath)}: ${error.message}`);
    }
  }

  if (allRows.length === 0) {
    throw new Error('No data found in any of the files');
  }

  // Create new workbook with flattened data
  const newWorkbook = XLSX.utils.book_new();
  const newSheet = XLSX.utils.aoa_to_sheet(allRows);
  XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'All POs');

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write the merged file
  XLSX.writeFile(newWorkbook, outputPath);

  console.log(`\n✅ Flattened file saved: ${outputPath}`);
  console.log(`   📊 Total rows: ${totalRows} (+ 1 header row)`);

  return outputPath;
}

/**
 * Flatten a single PO's data
 *
 * Flipkart PO structure:
 * - Row 0: Flipkart header
 * - Row 1: PO# and metadata (PO#, Nature of Supply, Category, Order Date, etc.)
 * - Row 2: Supplier name and address
 * - Row 3-4: Billing info
 * - Row 5-6: Payment details
 * - Row 7-8: Approval details
 * - Row 9: "ORDER DETAILS" label
 * - Row 10: Column headers for line items
 * - Row 11+: Actual line items (until summary row)
 *
 * This extracts PO metadata and prepends it to each line item row.
 *
 * @param {Array[]} data - Raw sheet data as array of arrays
 * @returns {Object} { headers: Array, rows: Array[] }
 */
function flattenPoData(data) {
  if (!data || data.length === 0) {
    return { headers: [], rows: [] };
  }

  // Extract PO metadata from header rows
  const metadata = extractPoMetadata(data);

  // Find the ORDER DETAILS section and line items
  let lineItemsHeaderIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    // Line items header row typically starts with "S. no." or similar
    if (row && row[0] && (row[0] === 'S. no.' || row[0] === 'S.no.' || row[0] === 'Sno' || row[0] === 'S No')) {
      lineItemsHeaderIndex = i;
      break;
    }
  }

  if (lineItemsHeaderIndex === -1) {
    // Fallback: can't find line items structure, return as-is
    return { headers: data[0] || [], rows: data.slice(1) };
  }

  // Get line items column headers
  const lineItemHeaders = data[lineItemsHeaderIndex] || [];

  // Create combined headers: metadata fields + line item fields
  const metadataHeaders = ['PO_Number', 'Category', 'Order_Date', 'PO_Expiry', 'Supplier_Name', 'Payment_Term'];
  const combinedHeaders = [...metadataHeaders, ...lineItemHeaders];

  // Extract line items (rows after header until we hit summary/total row)
  const lineItems = [];
  for (let i = lineItemsHeaderIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Line items have a numeric S.no. in first column
    const firstCell = row[0];
    if (typeof firstCell === 'number' || (typeof firstCell === 'string' && /^\d+$/.test(firstCell.trim()))) {
      // This is a line item row - prepend metadata
      const metadataValues = [
        metadata.poNumber || '',
        metadata.category || '',
        metadata.orderDate || '',
        metadata.poExpiry || '',
        metadata.supplierName || '',
        metadata.paymentTerm || ''
      ];
      const combinedRow = [...metadataValues, ...row];
      lineItems.push(combinedRow);
    } else if (firstCell && (String(firstCell).includes('Total') || String(firstCell).includes('Important'))) {
      // Reached summary section, stop processing
      break;
    }
  }

  return { headers: combinedHeaders, rows: lineItems };
}

/**
 * Extract PO metadata from header rows
 * @param {Array[]} data - Raw sheet data
 * @returns {Object} Extracted metadata
 */
function extractPoMetadata(data) {
  const metadata = {
    poNumber: '',
    category: '',
    orderDate: '',
    poExpiry: '',
    supplierName: '',
    paymentTerm: ''
  };

  // Row 1 typically has: PO#, value, Nature Of Supply, value, ..., CATEGORY, value, ORDER DATE, value
  const row1 = data[1] || [];
  for (let i = 0; i < row1.length - 1; i++) {
    const cell = row1[i];
    const nextCell = row1[i + 1];
    if (cell === 'PO#') metadata.poNumber = nextCell || '';
    if (cell === 'CATEGORY') metadata.category = nextCell || '';
    if (cell === 'ORDER DATE') metadata.orderDate = nextCell || '';
    if (cell === 'PO Expiry') metadata.poExpiry = nextCell || '';
  }

  // Row 2 has supplier name
  const row2 = data[2] || [];
  for (let i = 0; i < row2.length - 1; i++) {
    if (row2[i] === 'SUPPLIER NAME') {
      metadata.supplierName = row2[i + 1] || '';
      break;
    }
  }

  // Row 6 has payment term
  const row6 = data[6] || [];
  for (let i = 0; i < row6.length - 1; i++) {
    if (row6[i] === 'CREDIT TERM') {
      metadata.paymentTerm = row6[i + 1] || '';
      break;
    }
  }

  return metadata;
}
