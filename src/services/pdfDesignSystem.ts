import jsPDF from 'jspdf';

export type PdfOrientation = 'portrait' | 'landscape';
export type PdfCellAlign = 'left' | 'center' | 'right';

export interface PdfSummaryCard {
  label: string;
  value: string;
  accent?: 'navy' | 'orange' | 'red' | 'green' | 'slate';
}

export interface PdfStatusBadgeStyle {
  label: string;
  fill: [number, number, number];
  border: [number, number, number];
  text: [number, number, number];
  rowTint?: [number, number, number];
}

export interface PdfHeaderOptions {
  restaurantName: string;
  restaurantAddress?: string;
  reportTitle: string;
  dateRangeLabel?: string;
  generatedAt?: Date;
  timezone?: string;
  rightMetaLabel?: string;
}

export interface PdfTableColumn {
  header: string;
  weight?: number;
  align?: PdfCellAlign;
  isStatusBadge?: boolean;
  isBold?: boolean;
}

export interface PdfTableRenderOptions {
  columns: PdfTableColumn[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
  startY: number;
  headerOptions: PdfHeaderOptions;
  emptyMessage?: string;
  highlightStatusRows?: boolean;
}

export const STOQO_PDF_COLORS = {
  navy: [13, 33, 73] as [number, number, number], // #0D2149
  orange: [255, 90, 31] as [number, number, number], // #FF5A1F
  slate900: [15, 23, 42] as [number, number, number],
  slate700: [51, 65, 85] as [number, number, number],
  slate600: [71, 85, 105] as [number, number, number],
  slate400: [148, 163, 184] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  rowBorder: [226, 232, 240] as [number, number, number],
  lightBg: [248, 250, 252] as [number, number, number],
  zebraBg: [249, 250, 251] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  red: [185, 28, 28] as [number, number, number],
  redFill: [254, 242, 242] as [number, number, number],
  redBorder: [248, 113, 113] as [number, number, number],
  orangeDark: [194, 65, 12] as [number, number, number],
  orangeFill: [255, 247, 237] as [number, number, number],
  orangeBorder: [251, 146, 60] as [number, number, number],
  green: [4, 120, 87] as [number, number, number],
  greenFill: [236, 253, 245] as [number, number, number],
  greenBorder: [52, 211, 153] as [number, number, number],
  greyText: [71, 85, 105] as [number, number, number],
  greyFill: [241, 245, 249] as [number, number, number],
  greyBorder: [148, 163, 184] as [number, number, number],
};

export const A4_PORTRAIT_DIMENSIONS = {
  widthMm: 210,
  heightMm: 297,
} as const;

export const A4_LAYOUT = {
  marginX: 10, // Matches @page { size: A4 portrait; margin: 10mm; } -> 190mm printable width
  footerReservedHeight: 14,
};

/**
 * Creates a standardized A4 Portrait jsPDF instance (210mm x 297mm).
 * All STOQO PDF reports default strictly to A4 Portrait orientation.
 */
export function createA4PdfDocument(_orientation: PdfOrientation = 'portrait'): jsPDF {
  return new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
}

/**
 * Formats a Date in the restaurant's local timezone (defaults safely to Asia/Kolkata).
 */
export function formatPdfDateTime(date: Date = new Date(), timezone?: string): string {
  const tz = (timezone || '').trim() || 'Asia/Kolkata';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleString('en-IN');
  }
}

/**
 * Formats an amount in INR (₹) using Indian number grouping (e.g. "₹12,450.00").
 */
export function formatInrAmount(amount: number, currencySymbol: string = '₹'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = safe < 0 ? '-' : '';
  const absFormatted = Math.abs(safe).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${currencySymbol}${absFormatted}`;
}

/**
 * Sanitizes characters outside standard WinAnsi while preserving the Rupee symbol (₹)
 * for our dedicated vector Rupee glyph renderer.
 */
export function sanitizePdfText(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Draws a crisp, print-ready vector Indian Rupee symbol (₹) at the exact text baseline.
 * Avoids WinAnsi font garbling while rendering a genuine ₹ glyph at full vector DPI.
 */
function drawVectorRupeeGlyph(
  doc: jsPDF,
  x: number,
  baselineY: number,
  fontSizePt: number,
  color: [number, number, number]
): number {
  // 1 pt = 0.352778 mm; cap height of Helvetica is ~0.72 * fontSize
  const capH = fontSizePt * 0.352778 * 0.72;
  const w = capH * 0.62;
  const topY = baselineY - capH;
  const midY = topY + capH * 0.27;
  const bowlBottomY = topY + capH * 0.56;
  const strokeW = Math.max(0.18, capH * 0.115);

  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(strokeW);

  // Top horizontal bar
  doc.line(x, topY + strokeW * 0.4, x + w, topY + strokeW * 0.4);
  // Second horizontal bar
  doc.line(x, midY, x + w, midY);
  // Curved/angled upper bowl (right side of top half)
  const bowlRight = x + w * 0.68;
  doc.line(x + w * 0.36, topY + strokeW * 0.4, bowlRight, midY);
  doc.line(bowlRight, midY, x + w * 0.42, bowlBottomY);
  doc.line(x + w * 0.42, bowlBottomY, x + w * 0.08, bowlBottomY);
  // Diagonal descending leg
  doc.line(x + w * 0.12, bowlBottomY, x + w * 0.78, baselineY);

  doc.setLineWidth(0.2);
  return w + capH * 0.16;
}

/**
 * Measures rendered text width accurately when the string contains the Rupee symbol (₹).
 */
export function measurePdfTextWidth(doc: jsPDF, text: string, fontSizePt?: number): number {
  const clean = sanitizePdfText(text);
  if (!clean.includes('₹')) {
    return doc.getTextWidth(clean);
  }
  const pt = fontSizePt ?? doc.getFontSize();
  const capH = pt * 0.352778 * 0.72;
  const rupeeW = capH * 0.62 + capH * 0.16;
  const parts = clean.split('₹');
  let total = 0;
  parts.forEach((part, idx) => {
    if (part) total += doc.getTextWidth(part);
    if (idx < parts.length - 1) total += rupeeW;
  });
  return total;
}

/**
 * Draws a single line of text with full support for the INR Rupee symbol (₹) and left/center/right alignment.
 */
export function drawPdfText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options?: { align?: PdfCellAlign; color?: [number, number, number] }
): void {
  const clean = sanitizePdfText(text);
  const align = options?.align ?? 'left';
  const color = options?.color ?? STOQO_PDF_COLORS.slate900;
  doc.setTextColor(color[0], color[1], color[2]);

  if (!clean.includes('₹')) {
    doc.text(clean, x, y, align === 'left' ? undefined : { align });
    return;
  }

  const pt = doc.getFontSize();
  const totalWidth = measurePdfTextWidth(doc, clean, pt);
  let cursorX = x;
  if (align === 'right') {
    cursorX = x - totalWidth;
  } else if (align === 'center') {
    cursorX = x - totalWidth / 2;
  }

  const parts = clean.split('₹');
  parts.forEach((part, idx) => {
    if (part) {
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(part, cursorX, y);
      cursorX += doc.getTextWidth(part);
    }
    if (idx < parts.length - 1) {
      cursorX += drawVectorRupeeGlyph(doc, cursorX, y, pt, color);
    }
  });
}

/**
 * Draws the official undistorted 1:1 STOQO vector badge icon + wordmark + tagline.
 */
export function drawStoqoBrandLogo(
  doc: jsPDF,
  x: number,
  y: number,
  variant: 'full' | 'compact' = 'full'
): void {
  const iconSize = variant === 'full' ? 12 : 7;
  const radius = variant === 'full' ? 2.4 : 1.5;

  // Deep Navy 1:1 square badge
  doc.setFillColor(...STOQO_PDF_COLORS.navy);
  doc.roundedRect(x, y, iconSize, iconSize, radius, radius, 'F');

  // Electric Orange awning top strip (proportional to 1:1 icon)
  doc.setFillColor(...STOQO_PDF_COLORS.orange);
  doc.roundedRect(
    x + iconSize * 0.16,
    y + iconSize * 0.17,
    iconSize * 0.68,
    iconSize * 0.2,
    0.5,
    0.5,
    'F'
  );

  // Inventory cube faces
  doc.setFillColor(30, 58, 110);
  doc.rect(
    x + iconSize * 0.22,
    y + iconSize * 0.47,
    iconSize * 0.27,
    iconSize * 0.35,
    'F'
  );
  doc.setFillColor(...STOQO_PDF_COLORS.orange);
  doc.rect(
    x + iconSize * 0.51,
    y + iconSize * 0.47,
    iconSize * 0.28,
    iconSize * 0.35,
    'F'
  );

  const wordX = x + iconSize + (variant === 'full' ? 3 : 2.2);
  const wordY = y + (variant === 'full' ? 6.4 : 4.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(variant === 'full' ? 16.5 : 10.5);

  doc.setTextColor(...STOQO_PDF_COLORS.navy);
  doc.text('STO', wordX, wordY);
  const stoW = doc.getTextWidth('STO');
  doc.setTextColor(...STOQO_PDF_COLORS.orange);
  doc.text('Q', wordX + stoW, wordY);
  const qW = doc.getTextWidth('Q');
  doc.setTextColor(...STOQO_PDF_COLORS.navy);
  doc.text('O', wordX + stoW + qW, wordY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(variant === 'full' ? 7.5 : 6);
  doc.setTextColor(...STOQO_PDF_COLORS.orange);
  doc.text(
    'Smart Stock. Smarter Business.',
    wordX,
    y + (variant === 'full' ? 10.6 : 6.7)
  );
}

/**
 * Draws the primary Page 1 STOQO A4 Header and returns the next available Y coordinate.
 */
export function drawStoqoPageOneHeader(doc: jsPDF, options: PdfHeaderOptions): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const generatedText = formatPdfDateTime(options.generatedAt || new Date(), options.timezone);

  // Top Brand Bar
  doc.setFillColor(...STOQO_PDF_COLORS.navy);
  doc.rect(0, 0, pageWidth, 3.2, 'F');
  doc.setFillColor(...STOQO_PDF_COLORS.orange);
  doc.rect(0, 3.2, pageWidth, 1.0, 'F');

  const topY = 9.5;
  drawStoqoBrandLogo(doc, marginX, topY, 'full');

  // Right-aligned Report Title + Restaurant Info (auto-scaled to never collide with STOQO logo on A4 Portrait)
  const rightColumnMaxWidth = Math.max(80, contentWidth - 66);
  let titleFontSize = 13;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(titleFontSize);
  while (titleFontSize > 9.2 && measurePdfTextWidth(doc, options.reportTitle, titleFontSize) > rightColumnMaxWidth) {
    titleFontSize -= 0.4;
    doc.setFontSize(titleFontSize);
  }
  drawPdfText(doc, options.reportTitle, pageWidth - marginX, topY + 4.8, {
    align: 'right',
    color: STOQO_PDF_COLORS.navy,
  });

  const restUpper = (options.restaurantName || 'Restaurant').toUpperCase();
  let restFontSize = 9.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(restFontSize);
  while (restFontSize > 7.5 && measurePdfTextWidth(doc, restUpper, restFontSize) > rightColumnMaxWidth) {
    restFontSize -= 0.3;
    doc.setFontSize(restFontSize);
  }
  drawPdfText(doc, restUpper, pageWidth - marginX, topY + 9.5, {
    align: 'right',
    color: STOQO_PDF_COLORS.slate900,
  });

  if (options.restaurantAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const trimmedAddr = options.restaurantAddress.substring(0, 72);
    drawPdfText(doc, trimmedAddr, pageWidth - marginX, topY + 13.4, {
      align: 'right',
      color: STOQO_PDF_COLORS.slate600,
    });
  }

  const cursorY = topY + (options.restaurantAddress ? 16.2 : 13.8);

  // Reporting Metadata Strip
  doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, cursorY, contentWidth, 10.2, 1.5, 1.5, 'FD');

  const rightMetaText = options.rightMetaLabel || '';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  const rightMetaW = rightMetaText ? measurePdfTextWidth(doc, rightMetaText, 7.8) + 6 : 0;
  const leftMetaMaxW = Math.max(80, contentWidth - rightMetaW - 6.4);

  let periodFontSize = 7.8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(periodFontSize);
  const periodLabel = `Reporting Period: ${options.dateRangeLabel || `As of ${generatedText}`}`;
  while (periodFontSize > 6.4 && measurePdfTextWidth(doc, periodLabel, periodFontSize) > leftMetaMaxW) {
    periodFontSize -= 0.3;
    doc.setFontSize(periodFontSize);
  }
  drawPdfText(doc, periodLabel, marginX + 3.2, cursorY + 4.3, {
    color: STOQO_PDF_COLORS.navy,
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  drawPdfText(doc, `Generated: ${generatedText}`, marginX + 3.2, cursorY + 8.2, {
    color: STOQO_PDF_COLORS.slate600,
  });

  if (rightMetaText) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    drawPdfText(doc, rightMetaText, pageWidth - marginX - 3.2, cursorY + 6.3, {
      align: 'right',
      color: STOQO_PDF_COLORS.slate700,
    });
  }

  return cursorY + 13.8;
}

/**
 * Draws the compact branded STOQO continuation header on Page 2+ so every page has a clean header.
 */
export function drawStoqoContinuationHeader(
  doc: jsPDF,
  options: PdfHeaderOptions,
  sectionContinuationLabel?: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;

  doc.setFillColor(...STOQO_PDF_COLORS.navy);
  doc.rect(0, 0, pageWidth, 2.4, 'F');
  doc.setFillColor(...STOQO_PDF_COLORS.orange);
  doc.rect(0, 2.4, pageWidth, 0.8, 'F');

  drawStoqoBrandLogo(doc, marginX, 5.5, 'compact');

  const contTitle = `${options.reportTitle}  |  ${(options.restaurantName || 'Restaurant').toUpperCase()}`;
  const contMaxW = Math.max(85, contentWidth - 52);
  let contTitleSize = 8.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(contTitleSize);
  while (contTitleSize > 6.6 && measurePdfTextWidth(doc, contTitle, contTitleSize) > contMaxW) {
    contTitleSize -= 0.3;
    doc.setFontSize(contTitleSize);
  }
  drawPdfText(doc, contTitle, pageWidth - marginX, 9.2, {
    align: 'right',
    color: STOQO_PDF_COLORS.navy,
  });

  if (options.dateRangeLabel) {
    let contDateSize = 6.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(contDateSize);
    while (contDateSize > 5.8 && measurePdfTextWidth(doc, options.dateRangeLabel, contDateSize) > contMaxW) {
      contDateSize -= 0.25;
      doc.setFontSize(contDateSize);
    }
    drawPdfText(doc, options.dateRangeLabel, pageWidth - marginX, 12.6, {
      align: 'right',
      color: STOQO_PDF_COLORS.slate600,
    });
  }

  doc.setDrawColor(...STOQO_PDF_COLORS.border);
  doc.setLineWidth(0.25);
  doc.line(marginX, 14.2, pageWidth - marginX, 14.2);

  let nextY = 17.5;
  if (sectionContinuationLabel) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    drawPdfText(doc, sectionContinuationLabel, marginX, nextY, {
      color: STOQO_PDF_COLORS.orange,
    });
    nextY += 4;
  }
  return nextY;
}

/**
 * Renders KPI summary cards evenly across the printable A4 width.
 */
export function drawPdfSummaryCards(
  doc: jsPDF,
  cards: PdfSummaryCard[],
  startY: number
): number {
  if (!cards.length) return startY;
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const gap = cards.length >= 5 ? 2.2 : 3;
  const cardW = (contentWidth - gap * (cards.length - 1)) / cards.length;
  const cardH = 14.5;
  const padLeft = cards.length >= 5 ? 3.2 : 4.0;
  const textMaxW = Math.max(20, cardW - padLeft - 1.8);

  const accentMap: Record<NonNullable<PdfSummaryCard['accent']>, [number, number, number]> = {
    navy: STOQO_PDF_COLORS.navy,
    orange: STOQO_PDF_COLORS.orange,
    red: STOQO_PDF_COLORS.red,
    green: STOQO_PDF_COLORS.green,
    slate: STOQO_PDF_COLORS.slate600,
  };

  cards.forEach((card, idx) => {
    const cx = marginX + idx * (cardW + gap);
    const accent = accentMap[card.accent || 'navy'];

    doc.setFillColor(...STOQO_PDF_COLORS.white);
    doc.setDrawColor(...STOQO_PDF_COLORS.border);
    doc.setLineWidth(0.25);
    doc.roundedRect(cx, startY, cardW, cardH, 1.5, 1.5, 'FD');

    // Left color accent bar
    doc.setFillColor(...accent);
    doc.rect(cx, startY, 1.6, cardH, 'F');

    // Auto-scale card label so narrow portrait 5-card rows never clip
    const labelText = card.label.toUpperCase();
    let labelFontSize = cards.length >= 5 ? 6.0 : 6.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(labelFontSize);
    while (labelFontSize > 4.9 && measurePdfTextWidth(doc, labelText, labelFontSize) > textMaxW) {
      labelFontSize -= 0.25;
      doc.setFontSize(labelFontSize);
    }
    drawPdfText(doc, labelText, cx + padLeft, startY + 5.0, {
      color: STOQO_PDF_COLORS.slate600,
    });

    // Shrink value font smoothly if long Indian currency strings appear in portrait cards
    let valueFontSize = cards.length >= 5 ? 9.8 : 11.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(valueFontSize);
    while (valueFontSize > 6.8 && measurePdfTextWidth(doc, card.value, valueFontSize) > textMaxW) {
      valueFontSize -= 0.4;
      doc.setFontSize(valueFontSize);
    }

    drawPdfText(doc, card.value, cx + padLeft, startY + 11.5, {
      color:
        card.accent === 'red' || card.accent === 'orange' || card.accent === 'green'
          ? accent
          : STOQO_PDF_COLORS.slate900,
    });
  });

  return startY + cardH + 4.5;
}

/**
 * Resolves visual badge styling for inventory and operational status strings.
 */
export function resolvePdfStatusBadge(rawValue: string): PdfStatusBadgeStyle | null {
  const upper = String(rawValue || '').trim().toUpperCase();
  if (upper === 'OUT OF STOCK') {
    return {
      label: 'OUT OF STOCK',
      fill: STOQO_PDF_COLORS.redFill,
      border: STOQO_PDF_COLORS.redBorder,
      text: STOQO_PDF_COLORS.red,
      rowTint: [255, 248, 248],
    };
  }
  if (upper === 'LOW STOCK' || upper === 'LOW') {
    return {
      label: 'LOW STOCK',
      fill: STOQO_PDF_COLORS.orangeFill,
      border: STOQO_PDF_COLORS.orangeBorder,
      text: STOQO_PDF_COLORS.orangeDark,
      rowTint: [255, 251, 245],
    };
  }
  if (
    upper === 'IN STOCK' ||
    upper === 'SUFFICIENT' ||
    upper === 'PAID' ||
    upper === 'SIGNED' ||
    upper === 'RECEIVED' ||
    upper === 'SENT'
  ) {
    return {
      label: upper === 'SUFFICIENT' ? 'IN STOCK' : upper,
      fill: STOQO_PDF_COLORS.greenFill,
      border: STOQO_PDF_COLORS.greenBorder,
      text: STOQO_PDF_COLORS.green,
    };
  }
  if (upper === 'INACTIVE' || upper === 'ARCHIVED' || upper === 'DRAFT') {
    return {
      label: upper === 'ARCHIVED' ? 'INACTIVE' : upper,
      fill: STOQO_PDF_COLORS.greyFill,
      border: STOQO_PDF_COLORS.greyBorder,
      text: STOQO_PDF_COLORS.greyText,
    };
  }
  if (
    upper === 'PARTIALLY PAID' ||
    upper === 'PARTIALLY RECEIVED' ||
    upper === 'PARTIALLY_RECEIVED' ||
    upper === 'PENDING' ||
    upper === 'PENDING SEND' ||
    upper === 'PENDING_SEND' ||
    upper === 'EXCESS STOCK'
  ) {
    return {
      label: upper.replace(/_/g, ' '),
      fill: STOQO_PDF_COLORS.orangeFill,
      border: STOQO_PDF_COLORS.orangeBorder,
      text: STOQO_PDF_COLORS.orangeDark,
    };
  }
  if (upper === 'UNPAID' || upper === 'CANCELLED') {
    return {
      label: upper,
      fill: STOQO_PDF_COLORS.redFill,
      border: STOQO_PDF_COLORS.redBorder,
      text: STOQO_PDF_COLORS.red,
    };
  }
  return null;
}

/**
 * Renders a multi-page A4 table with:
 * - Proportional column widths (zero clipped columns)
 * - Automatic word wrapping for long item names & notes
 * - Repeated table headers on every new page
 * - Row-integrity page breaks (rows never split across pages)
 * - Colored status badges (LOW STOCK orange, OUT OF STOCK red, IN STOCK green, INACTIVE grey)
 * - Consistent INR (₹) rendering and numeric right-alignment
 */
export function renderA4Table(doc: jsPDF, options: PdfTableRenderOptions): number {
  const {
    columns,
    rows,
    totalsRow,
    headerOptions,
    emptyMessage = 'No records available for this report.',
    highlightStatusRows = false,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const usableBottomY = pageHeight - A4_LAYOUT.footerReservedHeight;

  const totalWeight = columns.reduce((sum, col) => sum + (col.weight ?? 1), 0);
  const colWidths = columns.map((col) => ((col.weight ?? 1) / totalWeight) * contentWidth);
  const colStarts: number[] = [];
  let accX = marginX;
  for (const w of colWidths) {
    colStarts.push(accX);
    accX += w;
  }

  // Portrait-tuned compact yet crisp typography & horizontal padding
  const fontSize = columns.length >= 9 ? 6.7 : columns.length >= 7 ? 7.2 : 8.0;
  const headerFontSize = columns.length >= 9 ? 6.4 : columns.length >= 7 ? 6.9 : 7.6;
  const lineHeight = fontSize * 0.44 + 0.5;
  const headerLineHeight = headerFontSize * 0.44 + 0.55;
  const cellPadX = columns.length >= 9 ? 1.2 : columns.length >= 7 ? 1.5 : 2.0;
  const cellPadY = columns.length >= 9 ? 1.5 : 1.75;

  // Pre-wrap column headers cleanly (supports explicit \n and automatic 2-line wrapping in Portrait)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(headerFontSize);
  const wrappedHeaders: string[][] = columns.map((col, idx) => {
    const maxW = Math.max(6, colWidths[idx] - cellPadX * 2);
    const manualLines = sanitizePdfText(col.header).split('\n');
    const out: string[] = [];
    for (const part of manualLines) {
      const split = doc.splitTextToSize(part, maxW) as string[];
      if (split.length > 0) out.push(...split);
    }
    return out.length > 0 ? out : [col.header];
  });
  const maxHeaderLines = Math.max(1, ...wrappedHeaders.map((lines) => lines.length));
  const headerHeight = Math.max(7.6, maxHeaderLines * headerLineHeight + 3.0);

  const drawHeaderBar = (y: number): number => {
    doc.setFillColor(...STOQO_PDF_COLORS.navy);
    doc.rect(marginX, y, contentWidth, headerHeight, 'F');
    doc.setDrawColor(...STOQO_PDF_COLORS.navy);
    doc.setLineWidth(0.2);
    doc.rect(marginX, y, contentWidth, headerHeight, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(headerFontSize);

    columns.forEach((col, i) => {
      const colX = colStarts[i];
      const colW = colWidths[i];
      const align = col.align || 'left';
      const lines = wrappedHeaders[i];
      const maxW = Math.max(6, colW - cellPadX * 2);

      const tx =
        align === 'right'
          ? colX + colW - cellPadX
          : align === 'center'
          ? colX + colW / 2
          : colX + cellPadX;

      const blockH = lines.length * headerLineHeight;
      const firstBaselineY = y + (headerHeight - blockH) / 2 + headerFontSize * 0.352778 * 0.85;

      lines.forEach((line, lineIdx) => {
        let lineFontSize = headerFontSize;
        doc.setFontSize(lineFontSize);
        while (lineFontSize > 5.4 && measurePdfTextWidth(doc, line, lineFontSize) > maxW) {
          lineFontSize -= 0.25;
          doc.setFontSize(lineFontSize);
        }
        drawPdfText(doc, line, tx, firstBaselineY + lineIdx * headerLineHeight, {
          align,
          color: STOQO_PDF_COLORS.white,
        });
      });
    });

    return y + headerHeight;
  };

  let cursorY = options.startY;
  if (cursorY + headerHeight + 10 > usableBottomY) {
    doc.addPage('a4', 'portrait');
    cursorY = drawStoqoContinuationHeader(doc, headerOptions);
  }
  cursorY = drawHeaderBar(cursorY);

  if (rows.length === 0) {
    doc.setFillColor(...STOQO_PDF_COLORS.lightBg);
    doc.setDrawColor(...STOQO_PDF_COLORS.border);
    doc.rect(marginX, cursorY, contentWidth, 14, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    drawPdfText(doc, emptyMessage, pageWidth / 2, cursorY + 8.5, {
      align: 'center',
      color: STOQO_PDF_COLORS.slate600,
    });
    return cursorY + 18;
  }

  const statusColIndices = columns
    .map((c, idx) => (c.isStatusBadge ? idx : -1))
    .filter((idx) => idx >= 0);

  rows.forEach((row, rowIdx) => {
    // Pre-calculate wrapped lines & row height before rendering so rows NEVER split mid-page
    doc.setFontSize(fontSize);
    const wrappedCells: string[][] = columns.map((col, colIdx) => {
      const rawText = sanitizePdfText(row[colIdx]);
      if (col.isStatusBadge) {
        return [rawText];
      }
      doc.setFont('helvetica', col.isBold ? 'bold' : 'normal');
      const maxWidth = Math.max(6, colWidths[colIdx] - cellPadX * 2);

      // Keep compact single-line numeric / currency tokens intact (auto-scaled if tight) instead of ugly mid-number wraps
      if (
        col.align === 'right' &&
        !rawText.includes('\n') &&
        rawText.length <= 20 &&
        measurePdfTextWidth(doc, rawText, Math.max(5.6, fontSize - 1.0)) <= maxWidth
      ) {
        return [rawText || '—'];
      }

      const adjustedMax = rawText.includes('₹') ? Math.max(6, maxWidth - 1.5) : maxWidth;
      const split = doc.splitTextToSize(rawText || '—', adjustedMax) as string[];
      return split.length > 0 ? split : ['—'];
    });

    const maxLines = Math.max(1, ...wrappedCells.map((lines) => lines.length));
    const rowHeight = Math.max(6.4, maxLines * lineHeight + cellPadY * 2);

    // Page break cleanly BEFORE drawing the row and repeat column headers
    if (cursorY + rowHeight > usableBottomY) {
      doc.addPage('a4', 'portrait');
      cursorY = drawStoqoContinuationHeader(doc, headerOptions);
      cursorY = drawHeaderBar(cursorY);
    }

    // Determine row background (optional highlight for OUT OF STOCK / LOW STOCK, else clean zebra striping)
    let rowFill: [number, number, number] | null =
      rowIdx % 2 === 1 ? STOQO_PDF_COLORS.zebraBg : STOQO_PDF_COLORS.white;

    if (highlightStatusRows && statusColIndices.length > 0) {
      for (const sIdx of statusColIndices) {
        const badge = resolvePdfStatusBadge(String(row[sIdx] ?? ''));
        if (badge?.rowTint) {
          rowFill = badge.rowTint;
          break;
        }
      }
    }

    if (rowFill) {
      doc.setFillColor(...rowFill);
      doc.rect(marginX, cursorY, contentWidth, rowHeight, 'F');
    }

    // Row horizontal & subtle outer vertical borders
    doc.setDrawColor(...STOQO_PDF_COLORS.rowBorder);
    doc.setLineWidth(0.18);
    doc.line(marginX, cursorY + rowHeight, marginX + contentWidth, cursorY + rowHeight);
    doc.line(marginX, cursorY, marginX, cursorY + rowHeight);
    doc.line(marginX + contentWidth, cursorY, marginX + contentWidth, cursorY + rowHeight);

    // Render each cell strictly within column boundaries
    columns.forEach((col, colIdx) => {
      const colX = colStarts[colIdx];
      const colW = colWidths[colIdx];
      const align = col.align || 'left';
      const cellValue = sanitizePdfText(row[colIdx]);
      const maxCellW = Math.max(5.5, colW - cellPadX * 2);

      if (col.isStatusBadge) {
        const badge = resolvePdfStatusBadge(cellValue);
        if (badge) {
          const maxPillW = Math.max(11, colW - 1.4);
          let badgeFontSize = columns.length >= 9 ? 5.6 : 6.2;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(badgeFontSize);
          while (badgeFontSize > 4.6 && doc.getTextWidth(badge.label) + 2.4 > maxPillW) {
            badgeFontSize -= 0.2;
            doc.setFontSize(badgeFontSize);
          }
          const textW = doc.getTextWidth(badge.label);
          const pillW = Math.min(maxPillW, Math.max(textW + 3.0, Math.min(14, maxPillW)));
          const pillH = 4.3;
          const pillX =
            align === 'right'
              ? colX + colW - cellPadX - pillW
              : align === 'left'
              ? colX + cellPadX
              : colX + (colW - pillW) / 2;
          const pillY = cursorY + (rowHeight - pillH) / 2;

          doc.setFillColor(...badge.fill);
          doc.setDrawColor(...badge.border);
          doc.setLineWidth(0.24);
          doc.roundedRect(pillX, pillY, pillW, pillH, 1.0, 1.0, 'FD');

          drawPdfText(doc, badge.label, pillX + pillW / 2, pillY + 3.0, {
            align: 'center',
            color: badge.text,
          });
          return;
        }
      }

      const lines = wrappedCells[colIdx];
      doc.setFont('helvetica', col.isBold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);

      const textBlockHeight = lines.length * lineHeight;
      const firstLineBaselineY =
        cursorY + (rowHeight - textBlockHeight) / 2 + fontSize * 0.352778 * 0.85;

      const tx =
        align === 'right'
          ? colX + colW - cellPadX
          : align === 'center'
          ? colX + colW / 2
          : colX + cellPadX;

      lines.forEach((line, lineIdx) => {
        let cellLineFontSize = fontSize;
        doc.setFontSize(cellLineFontSize);
        while (cellLineFontSize > 5.4 && measurePdfTextWidth(doc, line, cellLineFontSize) > maxCellW) {
          cellLineFontSize -= 0.25;
          doc.setFontSize(cellLineFontSize);
        }
        drawPdfText(doc, line, tx, firstLineBaselineY + lineIdx * lineHeight, {
          align,
          color: col.isBold ? STOQO_PDF_COLORS.slate900 : STOQO_PDF_COLORS.slate700,
        });
      });
    });

    cursorY += rowHeight;
  });

  // Optional Totals Row (overflow-safe across narrow portrait columns)
  if (totalsRow && totalsRow.length > 0) {
    const totalsHeight = 8;
    if (cursorY + totalsHeight > usableBottomY) {
      doc.addPage('a4', 'portrait');
      cursorY = drawStoqoContinuationHeader(doc, headerOptions);
      cursorY = drawHeaderBar(cursorY);
    }

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(...STOQO_PDF_COLORS.navy);
    doc.setLineWidth(0.3);
    doc.rect(marginX, cursorY, contentWidth, totalsHeight, 'FD');

    doc.setFont('helvetica', 'bold');
    const baseTotalFontSize = Math.min(8.2, fontSize + 0.3);
    columns.forEach((col, colIdx) => {
      const val = sanitizePdfText(totalsRow[colIdx] ?? '');
      if (!val) return;
      const colX = colStarts[colIdx];
      const colW = colWidths[colIdx];
      const align = col.align || 'left';
      const tx =
        align === 'right'
          ? colX + colW - cellPadX
          : align === 'center'
          ? colX + colW / 2
          : colX + cellPadX;

      // Allow left-aligned total labels (e.g., "TOTAL (12 Items)") to span adjacent empty cells cleanly
      let availableW = Math.max(8, colW - cellPadX * 2);
      if (align === 'left') {
        for (let next = colIdx + 1; next < columns.length; next++) {
          if (sanitizePdfText(totalsRow[next] ?? '')) break;
          availableW += colWidths[next];
        }
      } else if (align === 'right') {
        for (let prev = colIdx - 1; prev >= 0; prev--) {
          if (sanitizePdfText(totalsRow[prev] ?? '')) break;
          availableW += colWidths[prev];
        }
      }

      let cellFontSize = baseTotalFontSize;
      doc.setFontSize(cellFontSize);
      while (cellFontSize > 5.6 && measurePdfTextWidth(doc, val, cellFontSize) > availableW) {
        cellFontSize -= 0.25;
        doc.setFontSize(cellFontSize);
      }

      drawPdfText(doc, val, tx, cursorY + 5.1, {
        align,
        color: STOQO_PDF_COLORS.navy,
      });
    });

    cursorY += totalsHeight;
  }

  return cursorY + 4;
}

/**
 * Stamps the consistent STOQO footer with restaurant name, generated date/time,
 * and `Page X of Y` numbering across EVERY page of the PDF document.
 */
export function applyStoqoPageFooters(doc: jsPDF, options: PdfHeaderOptions): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = A4_LAYOUT.marginX;
  const contentWidth = pageWidth - marginX * 2;
  const generatedText = formatPdfDateTime(options.generatedAt || new Date(), options.timezone);

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const ruleY = pageHeight - 10.8;
    const textY = pageHeight - 6.8;

    doc.setDrawColor(...STOQO_PDF_COLORS.border);
    doc.setLineWidth(0.25);
    doc.line(marginX, ruleY, pageWidth - marginX, ruleY);

    const rightFooter = `Generated: ${generatedText}  |  Page ${p} of ${totalPages}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.0);
    const rightFooterW = measurePdfTextWidth(doc, rightFooter, 7.0);
    drawPdfText(doc, rightFooter, pageWidth - marginX, textY, {
      align: 'right',
      color: STOQO_PDF_COLORS.slate600,
    });

    const leftMaxW = Math.max(50, contentWidth - rightFooterW - 6);
    const leftFooter = options.restaurantName
      ? `STOQO – Smart Stock. Smarter Business.  |  ${options.restaurantName}`
      : 'STOQO – Smart Stock. Smarter Business.';
    let leftSize = 7.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(leftSize);
    while (leftSize > 5.6 && measurePdfTextWidth(doc, leftFooter, leftSize) > leftMaxW) {
      leftSize -= 0.25;
      doc.setFontSize(leftSize);
    }
    drawPdfText(doc, leftFooter, marginX, textY, {
      color: STOQO_PDF_COLORS.navy,
    });
  }
}
