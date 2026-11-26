import jsPDF from 'jspdf';
import { Item, Purchase, PurchaseOrder, StockCount } from '../types';
import { getInventoryStockStatus } from './calculations';
import {
  A4_LAYOUT,
  PdfHeaderOptions,
  PdfOrientation,
  PdfSummaryCard,
  PdfTableColumn,
  STOQO_PDF_COLORS,
  applyStoqoPageFooters,
  createA4PdfDocument,
  drawPdfSummaryCards,
  drawPdfText,
  drawStoqoContinuationHeader,
  drawStoqoPageOneHeader,
  formatInrAmount,
  formatPdfDateTime,
  renderA4Table,
  resolvePdfStatusBadge,
} from './pdfDesignSystem';

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const processCell = (cell: string | number) => {
    const stringVal = cell === null || cell === undefined ? '' : String(cell);
    if (stringVal.search(/("|,|\n)/g) >= 0) {
      return `"${stringVal.replace(/"/g, '""')}"`;
    }
    return stringVal;
  };

  const csvContent =
    'data:text/csv;charset=utf-8,' +
    [headers.map(processCell).join(','), ...rows.map((row) => row.map(processCell).join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToExcelCompatible(filename: string, headers: string[], rows: (string | number)[][]) {
  exportToCsv(`${filename}_excel`, headers, rows);
}

function formatQuantityClean(qty: number): string {
  const safe = Number.isFinite(qty) ? qty : 0;
  return Number.isInteger(safe) ? String(safe) : Number(safe.toFixed(2)).toString();
}

function makeSafeFilenameSlug(raw: string): string {
  return (raw || 'stoqo_report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Infers intelligent A4 column widths, alignment, and status badge treatment from header labels.
 */
function inferTableColumns(headers: string[], rows: (string | number)[][]): PdfTableColumn[] {
  return headers.map((header, idx) => {
    const h = header.trim().toLowerCase();

    if (h === '#' || h === 'no.' || h === 'no' || h === 'sr' || h === 'sr.') {
      return { header, weight: 0.45, align: 'center' };
    }

    if (h.includes('status')) {
      return { header, weight: 1.25, align: 'center', isStatusBadge: true };
    }

    const isNumericHeader =
      /\b(rate|value|amount|cost|total|paid|due|balance|qty|quantity|stock|days|variance|loss|count|billed|system|actual|diff|difference|minimum|min|reorder|wac|consumption|need|order|spent|purchase|issued|previous|new)\b/.test(
        h
      ) || h.includes('(₹)') || h.includes('₹');

    // Also inspect first few rows if header is ambiguous
    let sampleNumeric = false;
    if (!isNumericHeader && rows.length > 0) {
      const sampleVals = rows
        .slice(0, 6)
        .map((r) => String(r[idx] ?? '').trim())
        .filter(Boolean);
      if (
        sampleVals.length > 0 &&
        sampleVals.every((v) => /^[+-]?(₹|Rs\.?\s*)?[\d,]+(\.\d+)?(\s*(d|days|%))?$/i.test(v))
      ) {
        sampleNumeric = true;
      }
    }

    const isWideText =
      /\b(item|name|description|reason|notes|vendor|supplier|category|department|outlet|staff|adjusted by|recorded by|method|reference)\b/.test(
        h
      );
    const isMediumText = /\b(date|time|bill|invoice|phone|voucher|unit|uom)\b/.test(h);

    let weight = 1.1;
    if (h.includes('item name') || h.includes('description') || h.includes('reason') || h.includes('notes')) {
      weight = 2.1;
    } else if (isWideText) {
      weight = 1.45;
    } else if (h === 'unit' || h === 'uom') {
      weight = 0.65;
    } else if (isMediumText) {
      weight = 1.05;
    } else if (isNumericHeader) {
      weight = 1.1;
    }

    return {
      header,
      weight,
      align: h === 'unit' || h === 'uom' ? 'center' : isNumericHeader || sampleNumeric ? 'right' : 'left',
      isBold: idx === 0 && !h.includes('date') && h !== '#',
    };
  });
}

export interface GenericReportPdfOptions {
  orientation?: PdfOrientation;
  restaurantAddress?: string;
  dateRangeLabel?: string;
  timezone?: string;
  rightMetaLabel?: string;
  summaryCards?: PdfSummaryCard[];
  totalsRow?: (string | number)[];
  columns?: PdfTableColumn[];
  highlightStatusRows?: boolean;
  emptyMessage?: string;
  generatedAt?: Date;
}

/**
 * Builds a standardized, print-ready A4 PDF report using the unified STOQO design system.
 * Supports unlimited rows across multiple pages with repeated table headers and Page X of Y footers.
 */
export function buildGenericReportPdf(
  title: string,
  restaurantName: string,
  headers: string[],
  rows: (string | number)[][],
  options?: GenericReportPdfOptions
): jsPDF {
  // Always enforce A4 Portrait (210mm x 297mm) across all STOQO reports — never auto-switch to Landscape
  const doc = createA4PdfDocument('portrait');

  const generatedAt = options?.generatedAt ?? new Date();
  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress: options?.restaurantAddress,
    reportTitle: title,
    dateRangeLabel: options?.dateRangeLabel,
    generatedAt,
    timezone: options?.timezone,
    rightMetaLabel: options?.rightMetaLabel ?? `Total Records: ${rows.length}`,
  };

  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  if (options?.summaryCards && options.summaryCards.length > 0) {
    cursorY = drawPdfSummaryCards(doc, options.summaryCards, cursorY);
  }

  const columns = options?.columns ?? inferTableColumns(headers, rows);

  renderA4Table(doc, {
    columns,
    rows,
    totalsRow: options?.totalsRow,
    startY: cursorY,
    headerOptions,
    emptyMessage: options?.emptyMessage ?? 'No records available for this report.',
    highlightStatusRows: options?.highlightStatusRows ?? false,
  });

  applyStoqoPageFooters(doc, headerOptions);
  return doc;
}

export function exportToPdf(
  title: string,
  restaurantName: string,
  headers: string[],
  rows: (string | number)[][],
  options?: GenericReportPdfOptions
) {
  const doc = buildGenericReportPdf(title, restaurantName, headers, rows, options);
  doc.save(`${makeSafeFilenameSlug(title)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ============================================================================
// CURRENT STOCK INVENTORY REPORT PDF (Unified Live + PDF Low Stock Status)
// ============================================================================

export interface CurrentStockPdfEntry {
  item: Item;
  categoryName: string;
  departmentName: string;
  stockValue: number;
  daysOfStock?: number;
  stockDaysLabel?: string;
  isExcess?: boolean;
}

export interface CurrentStockPdfOptions {
  restaurantName: string;
  restaurantAddress?: string;
  timezone?: string;
  currencySymbol?: string;
  filterLabel?: string;
  items: CurrentStockPdfEntry[];
  generatedAt?: Date;
}

/**
 * Builds the standardized A4 Portrait Current Stock Inventory Report PDF (210mm x 297mm).
 * Uses `getInventoryStockStatus` (the exact single-source-of-truth logic used by StockView.tsx)
 * so every item's status (`OUT OF STOCK`, `LOW STOCK`, `IN STOCK`, `INACTIVE`) matches the live screen 100%.
 */
export function buildCurrentStockInventoryPdf(options: CurrentStockPdfOptions): jsPDF {
  const {
    restaurantName,
    restaurantAddress,
    timezone,
    currencySymbol = '₹',
    filterLabel,
    items,
    generatedAt = new Date(),
  } = options;

  const doc = createA4PdfDocument('portrait');

  // Compute unified status for every row using the shared source-of-truth helper
  const enriched = items.map((entry) => ({
    ...entry,
    statusInfo: getInventoryStockStatus(entry.item, Boolean(entry.isExcess)),
  }));

  let activeSkusCount = 0;
  let totalInventoryValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let inStockCount = 0;

  enriched.forEach((entry) => {
    totalInventoryValue += Number(entry.stockValue) || 0;
    if (entry.statusInfo.code !== 'INACTIVE') {
      activeSkusCount += 1;
    }
    if (entry.statusInfo.code === 'LOW_STOCK') {
      lowStockCount += 1;
    } else if (entry.statusInfo.code === 'OUT_OF_STOCK') {
      outOfStockCount += 1;
    } else if (entry.statusInfo.code === 'IN_STOCK') {
      inStockCount += 1;
    }
  });

  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress,
    reportTitle: 'Current Stock Inventory Report',
    dateRangeLabel: filterLabel
      ? `As of ${formatPdfDateTime(generatedAt, timezone)}  |  Filter: ${filterLabel}`
      : `As of ${formatPdfDateTime(generatedAt, timezone)}`,
    generatedAt,
    timezone,
    rightMetaLabel: `Items Listed: ${enriched.length}`,
    compact: true,
  };

  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  const summaryCards: PdfSummaryCard[] = [
    { label: 'Total Active SKUs', value: String(activeSkusCount), accent: 'navy' },
    {
      label: 'Total Inventory Value',
      value: formatInrAmount(totalInventoryValue, currencySymbol),
      accent: 'navy',
    },
    { label: 'Low Stock Items', value: String(lowStockCount), accent: 'orange' },
    { label: 'Out of Stock Items', value: String(outOfStockCount), accent: 'red' },
    { label: 'In Stock Items', value: String(inStockCount), accent: 'green' },
  ];

  cursorY = drawPdfSummaryCards(doc, summaryCards, cursorY, true);

  // Compact A4 Portrait 10-column layout across 194mm printable width (weights sum to 194mm).
  // Allocates generous width to Item Name, Category & Department so rows stay on 1 compact line while preserving ALL columns.
  const columns: PdfTableColumn[] = [
    { header: '#', weight: 6.5, align: 'center' },
    { header: 'Item Name', weight: 44.0, align: 'left', isBold: true },
    { header: 'Category', weight: 27.0, align: 'left' },
    { header: 'Department', weight: 21.5, align: 'left' },
    { header: 'Current\nStock', weight: 14.5, align: 'right', isBold: true },
    { header: 'Min /\nReorder', weight: 13.5, align: 'right' },
    { header: 'Avg Rate\n(WAC)', weight: 16.0, align: 'right' },
    { header: 'Stock\nValue', weight: 19.5, align: 'right', isBold: true },
    { header: 'Days\nStock', weight: 11.0, align: 'right' },
    { header: 'Stock\nStatus', weight: 20.5, align: 'center', isStatusBadge: true },
  ];

  const rows: (string | number)[][] = enriched.map((entry, idx) => {
    const unit = entry.item.unit || '';
    const minThreshold = entry.statusInfo.minThreshold;
    const minDisplay =
      minThreshold > 0 ? `${formatQuantityClean(minThreshold)} ${unit}` : 'Not Set';
    const avgRate = entry.item.averageStockRate || entry.item.lastPurchaseRate || 0;
    const daysDisplay =
      entry.stockDaysLabel ||
      (entry.daysOfStock === undefined
        ? '—'
        : entry.daysOfStock >= 999
        ? '999+ d'
        : `${Math.max(0, Math.round(entry.daysOfStock))} d`);

    return [
      idx + 1,
      entry.item.name,
      entry.categoryName || entry.item.category || 'Uncategorized',
      entry.departmentName || entry.item.departmentName || 'General Store',
      `${formatQuantityClean(entry.item.currentStock)} ${unit}`,
      minDisplay,
      formatInrAmount(avgRate, currencySymbol),
      formatInrAmount(entry.stockValue || 0, currencySymbol),
      daysDisplay,
      entry.statusInfo.pdfLabel,
    ];
  });

  const totalsRow: (string | number)[] = [
    '',
    `TOTAL (${enriched.length} ${enriched.length === 1 ? 'Item' : 'Items'})`,
    '',
    '',
    '',
    '',
    'Grand Total Value:',
    formatInrAmount(totalInventoryValue, currencySymbol),
    '',
    '',
  ];

  renderA4Table(doc, {
    columns,
    rows,
    totalsRow: rows.length > 0 ? totalsRow : undefined,
    startY: cursorY,
    headerOptions,
    emptyMessage: 'No inventory items match the selected filters.',
    highlightStatusRows: true,
    compact: true,
  });

  applyStoqoPageFooters(doc, headerOptions);
  return doc;
}

export function exportCurrentStockInventoryPdf(options: CurrentStockPdfOptions): void {
  const doc = buildCurrentStockInventoryPdf(options);
  const safeRest = makeSafeFilenameSlug(options.restaurantName || 'stoqo');
  doc.save(`STOQO_Current_Stock_${safeRest}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ============================================================================
// STOCK ADJUSTMENT HISTORY REPORT PDF
// ============================================================================

export interface StockAdjustmentPdfOptions {
  restaurantName: string;
  restaurantAddress?: string;
  timezone?: string;
  adjustments: StockCount[];
  generatedAt?: Date;
}

export function buildStockAdjustmentHistoryPdf(options: StockAdjustmentPdfOptions): jsPDF {
  const {
    restaurantName,
    restaurantAddress,
    timezone,
    adjustments,
    generatedAt = new Date(),
  } = options;

  const doc = createA4PdfDocument('portrait');

  const increases = adjustments.filter((a) => (Number(a.varianceQuantity) || 0) > 0).length;
  const decreases = adjustments.filter((a) => (Number(a.varianceQuantity) || 0) < 0).length;

  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress,
    reportTitle: 'Stock Adjustment History Report',
    dateRangeLabel: `Recorded Adjustments (as of ${formatPdfDateTime(generatedAt, timezone)})`,
    generatedAt,
    timezone,
    rightMetaLabel: `Adjustments: ${adjustments.length}`,
  };

  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  cursorY = drawPdfSummaryCards(
    doc,
    [
      { label: 'Total Adjustments', value: String(adjustments.length), accent: 'navy' },
      { label: 'Stock Increases (+)', value: String(increases), accent: 'green' },
      { label: 'Stock Decreases (-)', value: String(decreases), accent: 'red' },
    ],
    cursorY
  );

  // Portrait-optimized 7-column layout across 190mm printable width
  const columns: PdfTableColumn[] = [
    { header: 'Date & Time', weight: 1.4, align: 'left' },
    { header: 'Item Name', weight: 2.05, align: 'left', isBold: true },
    { header: 'Previous\nStock', weight: 1.05, align: 'right' },
    { header: 'New\nStock', weight: 1.05, align: 'right', isBold: true },
    { header: 'Difference', weight: 1.05, align: 'right', isBold: true },
    { header: 'Adjustment Reason', weight: 2.35, align: 'left' },
    { header: 'Adjusted By', weight: 1.45, align: 'left' },
  ];

  const rows: (string | number)[][] = adjustments.map((adj) => {
    const diff = Number(adj.varianceQuantity) || 0;
    const diffPrefix = diff > 0 ? '+' : '';
    const unit = adj.unit || '';

    return [
      formatPdfDateTime(new Date(adj.createdAt), timezone),
      adj.itemName,
      `${formatQuantityClean(adj.systemStock)} ${unit}`,
      `${formatQuantityClean(adj.physicalStock)} ${unit}`,
      `${diffPrefix}${formatQuantityClean(diff)} ${unit}`,
      adj.reason || 'Physical Stock Correction',
      adj.countedByName || 'Authorized User',
    ];
  });

  renderA4Table(doc, {
    columns,
    rows,
    startY: cursorY,
    headerOptions,
    emptyMessage: 'No manual stock adjustments have been recorded yet.',
  });

  applyStoqoPageFooters(doc, headerOptions);
  return doc;
}

export function exportStockAdjustmentHistoryPdf(options: StockAdjustmentPdfOptions): void {
  const doc = buildStockAdjustmentHistoryPdf(options);
  const safeRest = makeSafeFilenameSlug(options.restaurantName || 'stoqo');
  doc.save(`STOQO_Stock_Adjustments_${safeRest}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ============================================================================
// PURCHASE ORDER PDF (Standardized A4 Portrait)
// ============================================================================

export function buildPurchaseOrderPdf(
  po: PurchaseOrder,
  restaurantName: string,
  currencySymbol: string = '₹',
  restaurantAddress?: string,
  timezone?: string,
  generatedAt: Date = new Date()
): jsPDF {
  const doc = createA4PdfDocument('portrait');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const usableBottomY = pageHeight - A4_LAYOUT.footerReservedHeight;

  const isReceivedView = po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED';

  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress,
    reportTitle: 'Purchase Order',
    dateRangeLabel: `PO Date: ${formatPdfDateTime(new Date(po.createdAt), timezone)}`,
    generatedAt,
    timezone,
    rightMetaLabel: `PO #: ${po.poNumber}`,
  };

  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  // PO & Supplier Metadata Card
  const cardHeight = 27;
  doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, cursorY, contentWidth, cardHeight, 1.5, 1.5, 'FD');

  const leftColX = marginX + 3.5;
  const rightColX = marginX + contentWidth / 2 + 4;

  // Status badge top-right inside card
  const statusBadge = resolvePdfStatusBadge(po.status.replace(/_/g, ' ')) ?? {
    label: po.status.replace(/_/g, ' '),
    fill: STOQO_PDF_COLORS.greyFill,
    border: STOQO_PDF_COLORS.greyBorder,
    text: STOQO_PDF_COLORS.greyText,
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  const badgeW = Math.max(24, doc.getTextWidth(statusBadge.label) + 6);
  const badgeX = marginX + contentWidth - badgeW - 3.5;
  doc.setFillColor(...statusBadge.fill);
  doc.setDrawColor(...statusBadge.border);
  doc.roundedRect(badgeX, cursorY + 3, badgeW, 5.2, 1.2, 1.2, 'FD');
  drawPdfText(doc, statusBadge.label, badgeX + badgeW / 2, cursorY + 6.6, {
    align: 'center',
    color: statusBadge.text,
  });

  // Left column details
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  drawPdfText(doc, `PO Number: ${po.poNumber}`, leftColX, cursorY + 6.5, {
    color: STOQO_PDF_COLORS.navy,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  drawPdfText(doc, `Supplier: ${po.vendorName}`, leftColX, cursorY + 12.8, {
    color: STOQO_PDF_COLORS.slate900,
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  drawPdfText(
    doc,
    `Phone: ${po.vendorPhone || 'Not provided'}`,
    leftColX,
    cursorY + 18.8,
    { color: STOQO_PDF_COLORS.slate600 }
  );

  drawPdfText(
    doc,
    `Line Items: ${po.items.length}`,
    leftColX,
    cursorY + 24.2,
    { color: STOQO_PDF_COLORS.slate600 }
  );

  // Right column details
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  if (po.sentAt) {
    drawPdfText(
      doc,
      `Sent: ${formatPdfDateTime(new Date(po.sentAt), timezone)}`,
      rightColX,
      cursorY + 12.8,
      { color: STOQO_PDF_COLORS.slate700 }
    );
  }
  if (po.receivedAt) {
    drawPdfText(
      doc,
      `Received: ${formatPdfDateTime(new Date(po.receivedAt), timezone)}`,
      rightColX,
      cursorY + 18.8,
      { color: STOQO_PDF_COLORS.slate700 }
    );
  }
  if (po.billNumber) {
    doc.setFont('helvetica', 'bold');
    drawPdfText(
      doc,
      `Invoice / Bill No: ${po.billNumber}`,
      rightColX,
      cursorY + 24.2,
      { color: STOQO_PDF_COLORS.navy }
    );
  }

  cursorY += cardHeight + 5;

  // PO Items Table (strictly tax-free: Quantity x Rate = Amount, separate Quantity & UOM columns)
  const columns: PdfTableColumn[] = isReceivedView
    ? [
        { header: '#', weight: 0.42, align: 'center' },
        { header: 'Item Name', weight: 2.55, align: 'left', isBold: true },
        { header: 'Ordered', weight: 0.85, align: 'right' },
        { header: 'Received', weight: 0.9, align: 'right', isBold: true },
        { header: 'UOM', weight: 0.65, align: 'center' },
        { header: 'Actual\nRate', weight: 1.1, align: 'right' },
        { header: 'Amount', weight: 1.25, align: 'right', isBold: true },
      ]
    : [
        { header: '#', weight: 0.45, align: 'center' },
        { header: 'Item Name', weight: 3.1, align: 'left', isBold: true },
        { header: 'Quantity', weight: 0.95, align: 'right', isBold: true },
        { header: 'UOM', weight: 0.7, align: 'center' },
        { header: 'Rate', weight: 1.15, align: 'right' },
        { header: 'Amount', weight: 1.35, align: 'right', isBold: true },
      ];

  let computedSubtotal = 0;
  let computedTotalQty = 0;
  let computedReceivedSubtotal = 0;
  let computedReceivedQty = 0;

  const rows: (string | number)[][] = (po.items || []).map((item, idx) => {
    const ordered = Number(item.orderedQty ?? item.recommendedQuantity ?? 0) || 0;
    const estRate = Number(item.estimatedRate ?? 0) || 0;
    const estAmt = Number((ordered * estRate).toFixed(2));
    computedSubtotal = Number((computedSubtotal + estAmt).toFixed(2));
    computedTotalQty = Number((computedTotalQty + ordered).toFixed(2));

    if (isReceivedView) {
      const recv = Number(item.receivedQty ?? 0) || 0;
      const actualRate = Number(item.actualRate ?? estRate) || 0;
      const actualAmt = Number((recv * actualRate).toFixed(2));
      computedReceivedSubtotal = Number((computedReceivedSubtotal + actualAmt).toFixed(2));
      computedReceivedQty = Number((computedReceivedQty + recv).toFixed(2));
      return [
        idx + 1,
        item.itemName,
        formatQuantityClean(ordered),
        formatQuantityClean(recv),
        item.unit || '',
        formatInrAmount(actualRate, currencySymbol),
        formatInrAmount(actualAmt, currencySymbol),
      ];
    }

    return [
      idx + 1,
      item.itemName,
      formatQuantityClean(ordered),
      item.unit || '',
      formatInrAmount(estRate, currencySymbol),
      formatInrAmount(estAmt, currencySymbol),
    ];
  });

  const displaySubtotal = isReceivedView ? computedReceivedSubtotal : computedSubtotal;
  const displayTotalQty = isReceivedView ? computedReceivedQty : computedTotalQty;

  const totalsRow: (string | number)[] = isReceivedView
    ? [
        '',
        `TOTAL (${rows.length} ${rows.length === 1 ? 'Item' : 'Items'})`,
        formatQuantityClean(computedTotalQty),
        formatQuantityClean(computedReceivedQty),
        '',
        'Grand Total:',
        formatInrAmount(displaySubtotal, currencySymbol),
      ]
    : [
        '',
        `TOTAL (${rows.length} ${rows.length === 1 ? 'Item' : 'Items'})`,
        formatQuantityClean(computedTotalQty),
        '',
        'Grand Total:',
        formatInrAmount(displaySubtotal, currencySymbol),
      ];

  cursorY = renderA4Table(doc, {
    columns,
    rows,
    totalsRow: rows.length > 0 ? totalsRow : undefined,
    startY: cursorY,
    headerOptions,
    emptyMessage: 'No line items in this Purchase Order.',
  });

  // Financial Summary & Authorization Block (tax-free: Total Quantity, Subtotal, Grand Total)
  const summaryBlockH = 44;
  if (cursorY + summaryBlockH > usableBottomY) {
    doc.addPage('a4', 'portrait');
    cursorY = drawStoqoContinuationHeader(doc, headerOptions, `${po.poNumber} — Summary & Authorization`);
  }

  // Right-aligned summary box (Total Quantity, Subtotal, Grand Total — NO tax rows)
  const totalsBoxW = 82;
  const totalsBoxX = pageWidth - marginX - totalsBoxW;
  const totalsBoxH = 21.5;

  doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.roundedRect(totalsBoxX, cursorY, totalsBoxW, totalsBoxH, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  drawPdfText(doc, 'Total Quantity:', totalsBoxX + 3, cursorY + 5.2, {
    color: STOQO_PDF_COLORS.slate600,
  });
  drawPdfText(
    doc,
    `${formatQuantityClean(displayTotalQty)} (${rows.length} ${rows.length === 1 ? 'item' : 'items'})`,
    totalsBoxX + totalsBoxW - 3,
    cursorY + 5.2,
    { align: 'right', color: STOQO_PDF_COLORS.slate900 }
  );

  drawPdfText(doc, 'Subtotal:', totalsBoxX + 3, cursorY + 10.6, {
    color: STOQO_PDF_COLORS.slate600,
  });
  drawPdfText(doc, formatInrAmount(displaySubtotal, currencySymbol), totalsBoxX + totalsBoxW - 3, cursorY + 10.6, {
    align: 'right',
    color: STOQO_PDF_COLORS.slate900,
  });

  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.line(totalsBoxX + 3, cursorY + 13.4, totalsBoxX + totalsBoxW - 3, cursorY + 13.4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  drawPdfText(doc, 'Grand Total:', totalsBoxX + 3, cursorY + 18.4, {
    color: STOQO_PDF_COLORS.navy,
  });
  drawPdfText(doc, formatInrAmount(displaySubtotal, currencySymbol), totalsBoxX + totalsBoxW - 3, cursorY + 18.4, {
    align: 'right',
    color: STOQO_PDF_COLORS.navy,
  });

  cursorY += totalsBoxH + 7;

  // Terms & Authorization Line (wrapped cleanly within A4 Portrait contentWidth)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const noteLines = doc.splitTextToSize(
    'Note: All quantities and rates are subject to physical verification and supplier invoice confirmation upon goods receiving.',
    contentWidth
  ) as string[];
  noteLines.forEach((line, idx) => {
    drawPdfText(doc, line, marginX, cursorY + idx * 3.8, { color: STOQO_PDF_COLORS.slate600 });
  });

  cursorY += Math.max(8, noteLines.length * 3.8 + 6);
  doc.setDrawColor(...STOQO_PDF_COLORS.slate400);
  doc.setLineWidth(0.3);
  doc.line(marginX, cursorY, marginX + 68, cursorY);
  doc.line(pageWidth - marginX - 68, cursorY, pageWidth - marginX, cursorY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  drawPdfText(doc, 'Prepared / Authorized By (Store Manager)', marginX, cursorY + 4, {
    color: STOQO_PDF_COLORS.navy,
  });
  drawPdfText(doc, 'Supplier Acknowledgement', pageWidth - marginX, cursorY + 4, {
    align: 'right',
    color: STOQO_PDF_COLORS.navy,
  });

  applyStoqoPageFooters(doc, headerOptions);
  return doc;
}

export function exportPurchaseOrderPdf(
  po: PurchaseOrder,
  restaurantName: string,
  currencySymbol: string = '₹',
  restaurantAddress?: string,
  timezone?: string
) {
  const doc = buildPurchaseOrderPdf(po, restaurantName, currencySymbol, restaurantAddress, timezone);
  doc.save(`${po.poNumber}_${po.vendorName.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`);
}

// ============================================================================
// INWARD PURCHASE BILL PDF (Standardized A4 Portrait — Tax-Free)
// ============================================================================

export function buildInwardPurchaseBillPdf(
  purchase: Purchase,
  restaurantName: string,
  currencySymbol: string = '₹',
  restaurantAddress?: string,
  timezone?: string,
  generatedAt: Date = new Date()
): jsPDF {
  const doc = createA4PdfDocument('portrait');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const usableBottomY = pageHeight - A4_LAYOUT.footerReservedHeight;

  const receivedDateLabel = purchase.createdAt
    ? formatPdfDateTime(new Date(purchase.createdAt), timezone)
    : purchase.billDate;

  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress,
    reportTitle: 'Inward Purchase Receipt',
    dateRangeLabel: `Invoice Date: ${purchase.billDate}`,
    generatedAt,
    timezone,
    rightMetaLabel: `Bill #: ${purchase.billNumber}`,
  };

  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  // Supplier & Invoice Metadata Card
  const cardHeight = 25;
  doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, cursorY, contentWidth, cardHeight, 1.5, 1.5, 'FD');

  const leftColX = marginX + 3.5;
  const rightColX = marginX + contentWidth / 2 + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  drawPdfText(doc, `Supplier: ${purchase.vendorName || 'Vendor'}`, leftColX, cursorY + 6.5, {
    color: STOQO_PDF_COLORS.navy,
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  drawPdfText(doc, `Invoice / Bill Number: ${purchase.billNumber}`, leftColX, cursorY + 12.8, {
    color: STOQO_PDF_COLORS.slate900,
  });

  drawPdfText(
    doc,
    `PO Reference: ${purchase.poNumber || 'Direct Inward Purchase'}`,
    leftColX,
    cursorY + 19.0,
    { color: STOQO_PDF_COLORS.slate600 }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  drawPdfText(doc, `Invoice Date: ${purchase.billDate || '—'}`, rightColX, cursorY + 6.5, {
    color: STOQO_PDF_COLORS.slate900,
  });
  drawPdfText(doc, `Received Date: ${receivedDateLabel}`, rightColX, cursorY + 12.8, {
    color: STOQO_PDF_COLORS.slate700,
  });
  drawPdfText(
    doc,
    `Recorded By: ${purchase.recordedByName || 'Store Staff'}`,
    rightColX,
    cursorY + 19.0,
    { color: STOQO_PDF_COLORS.slate600 }
  );

  cursorY += cardHeight + 5;

  // Strictly tax-free line items: Received Qty x Actual Rate = Line Amount
  const columns: PdfTableColumn[] = [
    { header: '#', weight: 0.45, align: 'center' },
    { header: 'Item', weight: 3.05, align: 'left', isBold: true },
    { header: 'Received\nQty', weight: 1.0, align: 'right', isBold: true },
    { header: 'UOM', weight: 0.7, align: 'center' },
    { header: 'Actual\nRate', weight: 1.15, align: 'right' },
    { header: 'Line\nAmount', weight: 1.35, align: 'right', isBold: true },
  ];

  let subtotal = 0;
  let totalQty = 0;
  const rows: (string | number)[][] = (purchase.items || []).map((item, idx) => {
    const qty = Number(item.quantity) || 0;
    const rate = Number(item.purchaseRate ?? item.rate ?? 0) || 0;
    const lineAmount = Number((qty * rate).toFixed(2));
    subtotal = Number((subtotal + lineAmount).toFixed(2));
    totalQty = Number((totalQty + qty).toFixed(2));

    return [
      idx + 1,
      item.itemName || 'Item',
      formatQuantityClean(qty),
      item.unit || '',
      formatInrAmount(rate, currencySymbol),
      formatInrAmount(lineAmount, currencySymbol),
    ];
  });

  // Fallback for legacy bills without itemized lines
  const grandTotal = rows.length > 0 ? subtotal : Number(purchase.totalAmount || purchase.netAmount || 0);

  const totalsRow: (string | number)[] = [
    '',
    `TOTAL (${rows.length} ${rows.length === 1 ? 'Item' : 'Items'})`,
    formatQuantityClean(totalQty),
    '',
    'Grand Total:',
    formatInrAmount(grandTotal, currencySymbol),
  ];

  cursorY = renderA4Table(doc, {
    columns,
    rows,
    totalsRow: rows.length > 0 ? totalsRow : undefined,
    startY: cursorY,
    headerOptions,
    emptyMessage: 'No line items recorded on this inward purchase bill.',
  });

  // Summary Block (Subtotal & Grand Total — NO tax breakdown)
  const summaryBlockH = 34;
  if (cursorY + summaryBlockH > usableBottomY) {
    doc.addPage('a4', 'portrait');
    cursorY = drawStoqoContinuationHeader(doc, headerOptions, `Bill #${purchase.billNumber} — Summary`);
  }

  const totalsBoxW = 80;
  const totalsBoxX = pageWidth - marginX - totalsBoxW;
  const totalsBoxH = 16.5;

  doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.roundedRect(totalsBoxX, cursorY, totalsBoxW, totalsBoxH, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  drawPdfText(doc, 'Subtotal:', totalsBoxX + 3, cursorY + 5.5, {
    color: STOQO_PDF_COLORS.slate600,
  });
  drawPdfText(doc, formatInrAmount(grandTotal, currencySymbol), totalsBoxX + totalsBoxW - 3, cursorY + 5.5, {
    align: 'right',
    color: STOQO_PDF_COLORS.slate900,
  });

  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.line(totalsBoxX + 3, cursorY + 8.3, totalsBoxX + totalsBoxW - 3, cursorY + 8.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  drawPdfText(doc, 'Grand Total:', totalsBoxX + 3, cursorY + 13.4, {
    color: STOQO_PDF_COLORS.navy,
  });
  drawPdfText(doc, formatInrAmount(grandTotal, currencySymbol), totalsBoxX + totalsBoxW - 3, cursorY + 13.4, {
    align: 'right',
    color: STOQO_PDF_COLORS.navy,
  });

  applyStoqoPageFooters(doc, headerOptions);
  return doc;
}

export function exportInwardPurchaseBillPdf(
  purchase: Purchase,
  restaurantName: string,
  currencySymbol: string = '₹',
  restaurantAddress?: string,
  timezone?: string
): void {
  const doc = buildInwardPurchaseBillPdf(
    purchase,
    restaurantName,
    currencySymbol,
    restaurantAddress,
    timezone
  );
  const safeBill = makeSafeFilenameSlug(purchase.billNumber || 'inward_bill');
  const safeVendor = makeSafeFilenameSlug(purchase.vendorName || 'vendor');
  doc.save(`STOQO_Inward_Purchase_${safeBill}_${safeVendor}.pdf`);
}
