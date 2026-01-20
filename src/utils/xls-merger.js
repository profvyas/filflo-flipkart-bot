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
 * This extracts PO header info and prepends it to each line item row.
 * Uses a two-pass approach to handle files with different column structures:
 * 1. First pass: Collect all unique line item headers from all files
 * 2. Second pass: Map each file's data to the canonical header positions
 *
 * @param {string[]} filePaths - Array of file paths to merge
 * @param {string} outputPath - Path for the merged output file
 * @returns {string} Path to the merged file
 */
export function flattenAndMergePoFiles(filePaths, outputPath) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('No files provided to flatten and merge');
  }

  console.log(`\n📊 Flattening and merging ${filePaths.length} PO file(s)...`);

  // Fixed metadata headers (always in this order)
  const metadataHeaders = ['PO_Number', 'Category', 'Order_Date', 'PO_Expiry', 'Supplier_Name', 'Payment_Term'];

  // PASS 1: Collect all unique line item headers from all files
  console.log(`   🔍 Pass 1: Scanning files for column headers...`);
  const allLineItemHeadersSet = new Set();
  const fileDataCache = []; // Cache parsed data to avoid re-reading

  for (const filePath of filePaths) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (data.length === 0) {
        fileDataCache.push({ filePath, data: null });
        continue;
      }

      // Get line item headers from this file
      const lineItemHeaders = getLineItemHeaders(data);
      lineItemHeaders.forEach(h => {
        if (h !== undefined && h !== null && h !== '') {
          allLineItemHeadersSet.add(h);
        }
      });

      fileDataCache.push({ filePath, data, lineItemHeaders });
    } catch (error) {
      console.error(`   ❌ Error reading ${path.basename(filePath)}: ${error.message}`);
      fileDataCache.push({ filePath, data: null, error: error.message });
    }
  }

  // Build canonical header order: metadata + all unique line item headers
  // Preserve order by using the first file's headers as base, then append any extras
  const canonicalLineItemHeaders = [];
  for (const { lineItemHeaders } of fileDataCache) {
    if (lineItemHeaders) {
      for (const h of lineItemHeaders) {
        if (h !== undefined && h !== null && h !== '' && !canonicalLineItemHeaders.includes(h)) {
          canonicalLineItemHeaders.push(h);
        }
      }
    }
  }

  const canonicalHeaders = [...metadataHeaders, ...canonicalLineItemHeaders];
  console.log(`   📋 Canonical columns: ${canonicalHeaders.length} (${metadataHeaders.length} metadata + ${canonicalLineItemHeaders.length} line item)`);

  // PASS 2: Process data with column mapping
  console.log(`   🔄 Pass 2: Processing files with column alignment...`);
  const allRows = [canonicalHeaders]; // Start with header row
  let totalRows = 0;

  for (const { filePath, data, lineItemHeaders, error } of fileDataCache) {
    if (error || !data) {
      if (!error) console.log(`   ⚠️  Empty file: ${path.basename(filePath)}`);
      continue;
    }

    console.log(`   📄 Processing: ${path.basename(filePath)}`);

    // Build column mapping: source index -> canonical index
    const columnMapping = new Map();
    if (lineItemHeaders) {
      for (let srcIdx = 0; srcIdx < lineItemHeaders.length; srcIdx++) {
        const header = lineItemHeaders[srcIdx];
        if (header !== undefined && header !== null && header !== '') {
          const canonicalIdx = canonicalLineItemHeaders.indexOf(header);
          if (canonicalIdx !== -1) {
            // Add metadataHeaders.length offset since line items come after metadata
            columnMapping.set(srcIdx, metadataHeaders.length + canonicalIdx);
          }
        }
      }
    }

    // Flatten this PO's data using the column mapping
    const { metadata, lineItems } = extractPoDataWithMapping(data);

    // Map each line item row to canonical positions
    for (const row of lineItems) {
      // Create output row with all positions initialized to empty
      const outputRow = new Array(canonicalHeaders.length).fill('');

      // Fill metadata positions (0-5)
      outputRow[0] = metadata.poNumber || '';
      outputRow[1] = metadata.category || '';
      outputRow[2] = metadata.orderDate || '';
      outputRow[3] = metadata.poExpiry || '';
      outputRow[4] = metadata.supplierName || '';
      outputRow[5] = metadata.paymentTerm || '';

      // Fill line item positions using column mapping
      for (let srcIdx = 0; srcIdx < row.length; srcIdx++) {
        const targetIdx = columnMapping.get(srcIdx);
        if (targetIdx !== undefined) {
          outputRow[targetIdx] = row[srcIdx] !== undefined ? row[srcIdx] : '';
        }
      }

      allRows.push(outputRow);
    }

    totalRows += lineItems.length;
    console.log(`   ✅ Added ${lineItems.length} rows from ${path.basename(filePath)}`);
  }

  if (allRows.length <= 1) {
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
 * Get line item headers from a PO file's data
 * @param {Array[]} data - Raw sheet data as array of arrays
 * @returns {Array} Line item headers array
 */
function getLineItemHeaders(data) {
  if (!data || data.length === 0) return [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] && (row[0] === 'S. no.' || row[0] === 'S.no.' || row[0] === 'Sno' || row[0] === 'S No')) {
      return row;
    }
  }
  return [];
}

/**
 * Extract PO data with raw line items (no header combining)
 * @param {Array[]} data - Raw sheet data as array of arrays
 * @returns {Object} { metadata, lineItems }
 */
function extractPoDataWithMapping(data) {
  const metadata = extractPoMetadata(data);
  const lineItems = [];

  // Find line items header row
  let lineItemsHeaderIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] && (row[0] === 'S. no.' || row[0] === 'S.no.' || row[0] === 'Sno' || row[0] === 'S No')) {
      lineItemsHeaderIndex = i;
      break;
    }
  }

  if (lineItemsHeaderIndex === -1) {
    return { metadata, lineItems: [] };
  }

  // Extract line items (rows after header until summary row)
  for (let i = lineItemsHeaderIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const firstCell = row[0];
    if (typeof firstCell === 'number' || (typeof firstCell === 'string' && /^\d+$/.test(firstCell.trim()))) {
      // This is a line item row - store raw row data
      lineItems.push(row);
    } else if (firstCell && (String(firstCell).includes('Total') || String(firstCell).includes('Important'))) {
      // Reached summary section, stop processing
      break;
    }
  }

  return { metadata, lineItems };
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
