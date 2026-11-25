import jsPDF from 'jspdf';
import { IssueSession } from '../types';
import {
  IssueDateRange,
  buildDepartmentIssueSummary,
  buildShiftIssueSummary,
  formatDateKeyReadable,
  formatDateTimeInTimeZone,
  formatQty,
  formatShiftLabel,
  isIssueSessionBackdated,
  resolveSafeTimeZone,
} from '../utils/issueManagement';
import {
  A4_LAYOUT,
  PdfHeaderOptions,
  STOQO_PDF_COLORS,
  applyStoqoPageFooters,
  createA4PdfDocument,
  drawPdfSummaryCards,
  drawPdfText,
  drawStoqoContinuationHeader,
  drawStoqoPageOneHeader,
  formatInrAmount,
} from './pdfDesignSystem';

export interface IssueReportPdfOptions {
  restaurantName: string;
  restaurantAddress?: string;
  currencySymbol?: string;
  timezone?: string;
  dateRange: IssueDateRange;
  sessions: IssueSession[];
  generatedAt?: Date;
}

const NAVY = STOQO_PDF_COLORS.navy;
const ORANGE = STOQO_PDF_COLORS.orange;
const SLATE_900 = STOQO_PDF_COLORS.slate900;
const SLATE_600 = STOQO_PDF_COLORS.slate600;
const SLATE_400 = STOQO_PDF_COLORS.slate400;
const BORDER = STOQO_PDF_COLORS.border;
const LIGHT_BG = STOQO_PDF_COLORS.lightBg;
const ZEBRA_BG = STOQO_PDF_COLORS.zebraBg;
const EMERALD_DARK = STOQO_PDF_COLORS.green;
const AMBER_DARK = STOQO_PDF_COLORS.orangeDark;

/**
 * Draws the column header bar for an issue session's item table.
 * Called at the start of every session table AND repeated automatically on page breaks.
 */
function drawItemTableHeader(
  doc: jsPDF,
  marginX: number,
  contentWidth: number,
  y: number
): number {
  const rowHeight = 7;
  doc.setFillColor(...NAVY);
  doc.rect(marginX, y, contentWidth, rowHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(255, 255, 255);

  const textY = y + 4.8;
  doc.text('No.', marginX + 2.5, textY);
  doc.text('Item Name', marginX + 14, textY);
  doc.text('Quantity', marginX + 114, textY, { align: 'right' });
  doc.text('UOM', marginX + 134, textY, { align: 'center' });
  doc.text('Cost', marginX + contentWidth - 3, textY, { align: 'right' });

  return y + rowHeight;
}

/**
 * Builds the combined Store to Kitchen Issue Report jsPDF document in standardized A4 portrait layout.
 * Reuses the shared STOQO A4 PDF design system for headers, KPI cards, crisp INR (₹) rendering,
 * and consistent Page X of Y footers while preserving exact saved digital signatures.
 */
export function buildStoreToKitchenIssuePdf(options: IssueReportPdfOptions): jsPDF {
  const {
    restaurantName,
    restaurantAddress,
    currencySymbol = '₹',
    timezone,
    dateRange,
    sessions,
    generatedAt = new Date(),
  } = options;

  const tz = resolveSafeTimeZone(timezone);
  const doc = createA4PdfDocument('portrait');
  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const marginX = A4_LAYOUT.marginX; // 12mm
  const contentWidth = pageWidth - marginX * 2; // 186mm
  const usableBottomY = pageHeight - A4_LAYOUT.footerReservedHeight;

  // Order sessions chronologically ascending by selected Issue Date, then creation timestamp
  const orderedSessions = [...sessions].sort((a, b) => {
    const dateCmp = (a.issueDate || '').localeCompare(b.issueDate || '');
    if (dateCmp !== 0) return dateCmp;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  const totalSessions = orderedSessions.length;
  const totalItemsIssued = orderedSessions.reduce(
    (sum, s) => sum + (s.items?.length || s.totalItems || 0),
    0
  );
  const grandTotalValue = Number(
    orderedSessions.reduce((sum, s) => sum + (Number(s.totalValue) || 0), 0).toFixed(2)
  );
  const departmentSummary = buildDepartmentIssueSummary(orderedSessions);
  const shiftSummary = buildShiftIssueSummary(orderedSessions);

  const headerOptions: PdfHeaderOptions = {
    restaurantName: restaurantName || 'Restaurant',
    restaurantAddress,
    reportTitle: 'Store to Kitchen Issue Report',
    dateRangeLabel: dateRange.label,
    generatedAt,
    timezone: tz,
    rightMetaLabel: `Sessions Included: ${totalSessions}`,
  };

  // -------------------------------------------------------------------------
  // 1. UNIFIED STOQO A4 REPORT HEADER (Page 1)
  // -------------------------------------------------------------------------
  let cursorY = drawStoqoPageOneHeader(doc, headerOptions);

  // -------------------------------------------------------------------------
  // 2. EXECUTIVE SUMMARY & DEPARTMENT BREAKDOWN
  // -------------------------------------------------------------------------
  cursorY = drawPdfSummaryCards(
    doc,
    [
      { label: 'Total Issue Sessions', value: String(totalSessions), accent: 'navy' },
      { label: 'Total Items Issued', value: String(totalItemsIssued), accent: 'orange' },
      {
        label: 'Total Issue Value',
        value: formatInrAmount(grandTotalValue, currencySymbol),
        accent: 'navy',
      },
    ],
    cursorY
  );

  const startNewPage = (continuationLabel?: string): number => {
    doc.addPage();
    return drawStoqoContinuationHeader(doc, headerOptions, continuationLabel);
  };

  // Department-wise Issue Summary table
  if (departmentSummary.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    drawPdfText(doc, 'Department-wise Issue Summary', marginX, cursorY, { color: NAVY });
    cursorY += 2.6;

    const drawDeptHeader = (y: number): number => {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(...BORDER);
      doc.rect(marginX, y, contentWidth, 6.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      drawPdfText(doc, 'Department', marginX + 3, y + 4.4, { color: NAVY });
      drawPdfText(doc, 'Sessions', marginX + 104, y + 4.4, { align: 'right', color: NAVY });
      drawPdfText(doc, 'Items Issued', marginX + 136, y + 4.4, { align: 'right', color: NAVY });
      drawPdfText(doc, 'Total Value', marginX + contentWidth - 3, y + 4.4, {
        align: 'right',
        color: NAVY,
      });
      return y + 6.5;
    };

    cursorY = drawDeptHeader(cursorY);

    departmentSummary.forEach((row, idx) => {
      if (cursorY + 6.5 > usableBottomY) {
        cursorY = startNewPage('Department-wise Issue Summary (Continued)');
        cursorY = drawDeptHeader(cursorY);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(...ZEBRA_BG);
        doc.rect(marginX, cursorY, contentWidth, 6.2, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, cursorY + 6.2, marginX + contentWidth, cursorY + 6.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      drawPdfText(doc, row.departmentName.substring(0, 44), marginX + 3, cursorY + 4.3, {
        color: SLATE_900,
      });
      drawPdfText(doc, String(row.sessionCount), marginX + 104, cursorY + 4.3, {
        align: 'right',
        color: SLATE_900,
      });
      drawPdfText(doc, String(row.itemCount), marginX + 136, cursorY + 4.3, {
        align: 'right',
        color: SLATE_900,
      });
      doc.setFont('helvetica', 'bold');
      drawPdfText(
        doc,
        formatInrAmount(row.totalValue, currencySymbol),
        marginX + contentWidth - 3,
        cursorY + 4.3,
        { align: 'right', color: SLATE_900 }
      );
      cursorY += 6.2;
    });

    cursorY += 6;
  }

  // Shift-wise Issue Summary table
  if (shiftSummary.length > 0) {
    if (cursorY + 20 > usableBottomY) {
      cursorY = startNewPage('Shift-wise Issue Summary');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    drawPdfText(doc, 'Shift-wise Issue Summary', marginX, cursorY, { color: NAVY });
    cursorY += 2.6;

    const drawShiftHeader = (y: number): number => {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(...BORDER);
      doc.rect(marginX, y, contentWidth, 6.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      drawPdfText(doc, 'Shift', marginX + 3, y + 4.4, { color: NAVY });
      drawPdfText(doc, 'Sessions', marginX + 104, y + 4.4, { align: 'right', color: NAVY });
      drawPdfText(doc, 'Items Issued', marginX + 136, y + 4.4, { align: 'right', color: NAVY });
      drawPdfText(doc, 'Total Value', marginX + contentWidth - 3, y + 4.4, {
        align: 'right',
        color: NAVY,
      });
      return y + 6.5;
    };

    cursorY = drawShiftHeader(cursorY);

    shiftSummary.forEach((row, idx) => {
      if (cursorY + 6.5 > usableBottomY) {
        cursorY = startNewPage('Shift-wise Issue Summary (Continued)');
        cursorY = drawShiftHeader(cursorY);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(...ZEBRA_BG);
        doc.rect(marginX, cursorY, contentWidth, 6.2, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, cursorY + 6.2, marginX + contentWidth, cursorY + 6.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      drawPdfText(doc, row.shiftLabel, marginX + 3, cursorY + 4.3, { color: SLATE_900 });
      drawPdfText(doc, String(row.sessionCount), marginX + 104, cursorY + 4.3, {
        align: 'right',
        color: SLATE_900,
      });
      drawPdfText(doc, String(row.itemCount), marginX + 136, cursorY + 4.3, {
        align: 'right',
        color: SLATE_900,
      });
      doc.setFont('helvetica', 'bold');
      drawPdfText(
        doc,
        formatInrAmount(row.totalValue, currencySymbol),
        marginX + contentWidth - 3,
        cursorY + 4.3,
        { align: 'right', color: SLATE_900 }
      );
      cursorY += 6.2;
    });

    cursorY += 6;
  }

  // Empty state if no sessions exist in selected period
  if (orderedSessions.length === 0) {
    doc.setFillColor(...LIGHT_BG);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(marginX, cursorY, contentWidth, 22, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    drawPdfText(
      doc,
      'No Store to Kitchen issue sessions recorded for this period.',
      pageWidth / 2,
      cursorY + 12.5,
      { align: 'center', color: SLATE_600 }
    );
  }

  // -------------------------------------------------------------------------
  // 3. SEPARATE SECTION FOR EACH ISSUE SESSION
  // -------------------------------------------------------------------------
  orderedSessions.forEach((session, sIdx) => {
    const backdated = isIssueSessionBackdated(session, tz);
    const formattedIssueDate = formatDateKeyReadable(session.issueDate);
    const formattedRecordedOn = formatDateTimeInTimeZone(session.createdAt, tz);

    // Ensure enough room for session header + metadata + table header + at least 2 rows (~52mm)
    if (cursorY + 52 > usableBottomY) {
      cursorY = startNewPage();
    }

    // Session Banner Header
    doc.setFillColor(...NAVY);
    doc.roundedRect(marginX, cursorY, contentWidth, 8, 1.2, 1.2, 'F');
    doc.setFillColor(...ORANGE);
    doc.rect(marginX, cursorY, 2.2, 8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `Issue #${session.issueNumber}${backdated ? '  [BACKDATED]' : ''}`,
      marginX + 5,
      cursorY + 5.3
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(226, 232, 240);
    doc.text(
      `Session ${sIdx + 1} of ${orderedSessions.length}  |  Issue Date: ${formattedIssueDate}`,
      pageWidth - marginX - 3,
      cursorY + 5.3,
      { align: 'right' }
    );
    cursorY += 8;

    // Session Metadata Card (3 clean rows: Dept/Shift, Issue Date/Recorded On, Issued By/Received By)
    const metaHeight = 19.5;
    doc.setFillColor(...LIGHT_BG);
    doc.setDrawColor(...BORDER);
    doc.rect(marginX, cursorY, contentWidth, metaHeight, 'FD');

    const col1X = marginX + 3;
    const col2X = marginX + contentWidth / 2 + 2;

    doc.setFontSize(8);
    // Row 1: Issue Date & Entry Recorded On
    doc.setFont('helvetica', 'bold');
    drawPdfText(doc, 'Issue Date:', col1X, cursorY + 5, { color: SLATE_600 });
    drawPdfText(
      doc,
      `${formattedIssueDate}${backdated ? ' (Backdated)' : ''}`,
      col1X + 20,
      cursorY + 5,
      { color: backdated ? ORANGE : NAVY }
    );

    drawPdfText(doc, 'Entry Recorded On:', col2X, cursorY + 5, { color: SLATE_600 });
    doc.setFont('helvetica', 'normal');
    drawPdfText(doc, formattedRecordedOn, col2X + 31, cursorY + 5, { color: SLATE_900 });

    // Row 2: Kitchen Department & Shift
    doc.setFont('helvetica', 'bold');
    drawPdfText(doc, 'Kitchen Department:', col1X, cursorY + 10.5, { color: SLATE_600 });
    drawPdfText(doc, (session.departmentName || 'Kitchen').substring(0, 34), col1X + 33, cursorY + 10.5, {
      color: SLATE_900,
    });

    drawPdfText(doc, 'Shift:', col2X, cursorY + 10.5, { color: SLATE_600 });
    drawPdfText(doc, formatShiftLabel(session.shift), col2X + 12, cursorY + 10.5, { color: SLATE_900 });

    // Row 3: Issued By & Received By
    drawPdfText(doc, 'Issued By:', col1X, cursorY + 16, { color: SLATE_600 });
    doc.setFont('helvetica', 'normal');
    drawPdfText(
      doc,
      (session.issuedByName || 'Storekeeper').substring(0, 36),
      col1X + 18,
      cursorY + 16,
      { color: SLATE_900 }
    );

    doc.setFont('helvetica', 'bold');
    drawPdfText(doc, 'Received By:', col2X, cursorY + 16, { color: SLATE_600 });
    drawPdfText(
      doc,
      (session.receivedByName || 'Chef / Staff').substring(0, 36),
      col2X + 22,
      cursorY + 16,
      { color: SLATE_900 }
    );

    cursorY += metaHeight + 2;

    // Item Table Header
    cursorY = drawItemTableHeader(doc, marginX, contentWidth, cursorY);

    // Item Rows (with automatic multi-page pagination & repeated headers!)
    const sessionItems = session.items || [];
    sessionItems.forEach((item, itemIdx) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      const wrappedName = doc.splitTextToSize(item.itemName || 'Item', 86) as string[];
      const rowHeight = Math.max(6.5, wrappedName.length * 4 + 2.5);

      if (cursorY + rowHeight > usableBottomY) {
        cursorY = startNewPage(`Issue #${session.issueNumber} — ${session.departmentName} (Continued)`);
        cursorY = drawItemTableHeader(doc, marginX, contentWidth, cursorY);
      }

      if (itemIdx % 2 === 1) {
        doc.setFillColor(...ZEBRA_BG);
        doc.rect(marginX, cursorY, contentWidth, rowHeight, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, cursorY + rowHeight, marginX + contentWidth, cursorY + rowHeight);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      drawPdfText(doc, String(itemIdx + 1), marginX + 2.5, cursorY + 4.4, { color: SLATE_600 });

      doc.setFont('helvetica', 'bold');
      wrappedName.forEach((line, lineIdx) => {
        drawPdfText(doc, line, marginX + 14, cursorY + 4.4 + lineIdx * 4, { color: SLATE_900 });
      });

      doc.setFont('helvetica', 'bold');
      drawPdfText(doc, formatQty(item.quantity), marginX + 114, cursorY + 4.4, {
        align: 'right',
        color: SLATE_900,
      });

      doc.setFont('helvetica', 'normal');
      drawPdfText(doc, String(item.unit || ''), marginX + 134, cursorY + 4.4, {
        align: 'center',
        color: SLATE_600,
      });

      doc.setFont('helvetica', 'bold');
      drawPdfText(
        doc,
        formatInrAmount(Number(item.value) || 0, currencySymbol),
        marginX + contentWidth - 3,
        cursorY + 4.4,
        { align: 'right', color: SLATE_900 }
      );

      cursorY += rowHeight;
    });

    // Session Subtotal Row
    if (cursorY + 8 > usableBottomY) {
      cursorY = startNewPage(`Issue #${session.issueNumber} — Subtotal`);
    }
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(...BORDER);
    doc.rect(marginX, cursorY, contentWidth, 7.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    drawPdfText(
      doc,
      `Session Subtotal (${sessionItems.length} ${sessionItems.length === 1 ? 'item' : 'items'})`,
      marginX + 3,
      cursorY + 5,
      { color: NAVY }
    );
    drawPdfText(
      doc,
      formatInrAmount(Number(session.totalValue) || 0, currencySymbol),
      marginX + contentWidth - 3,
      cursorY + 5,
      { align: 'right', color: NAVY }
    );
    cursorY += 9.5;

    // Dual Signature Block (Manager Signature + Received By Chef/Staff) — preserved verbatim!
    const sigBoxHeight = 32;
    if (cursorY + sigBoxHeight > usableBottomY) {
      cursorY = startNewPage(`Issue #${session.issueNumber} — Signatures`);
    }

    const sigGap = 6;
    const sigBoxWidth = (contentWidth - sigGap) / 2;

    const renderSignatureBox = (
      x: number,
      title: string,
      signature: IssueSession['managerSignature'],
      fallbackName: string,
      nameLabel: string
    ) => {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...BORDER);
      doc.roundedRect(x, cursorY, sigBoxWidth, sigBoxHeight, 1.5, 1.5, 'FD');

      // Box Header Strip
      doc.setFillColor(...LIGHT_BG);
      doc.rect(x + 0.3, cursorY + 0.3, sigBoxWidth - 0.6, 5.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      drawPdfText(doc, title, x + 2.5, cursorY + 4, { color: NAVY });

      const isSigned = signature?.status === 'SIGNED' && Boolean(signature.signatureDataUrl);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      if (isSigned) {
        drawPdfText(doc, 'SIGNED', x + sigBoxWidth - 2.5, cursorY + 4, {
          align: 'right',
          color: EMERALD_DARK,
        });
      } else {
        drawPdfText(doc, 'Pending Signature', x + sigBoxWidth - 2.5, cursorY + 4, {
          align: 'right',
          color: AMBER_DARK,
        });
      }

      // Signature Image Area (blank with subtle dashed box when pending, actual saved PNG when signed)
      const areaX = x + 3;
      const areaY = cursorY + 7;
      const areaW = sigBoxWidth - 6;
      const areaH = 13.5;

      if (isSigned && signature.signatureDataUrl) {
        try {
          doc.addImage(
            signature.signatureDataUrl,
            'PNG',
            areaX + 2,
            areaY,
            areaW - 4,
            areaH,
            undefined,
            'FAST'
          );
        } catch {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          drawPdfText(doc, '[Digital Signature Recorded]', x + sigBoxWidth / 2, areaY + 8, {
            align: 'center',
            color: SLATE_600,
          });
        }
      } else {
        doc.setDrawColor(226, 232, 240);
        doc.setLineDashPattern([1, 1], 0);
        doc.rect(areaX, areaY, areaW, areaH, 'S');
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        drawPdfText(doc, 'Pending Signature', x + sigBoxWidth / 2, areaY + 7.8, {
          align: 'center',
          color: SLATE_400,
        });
      }

      // Name & Date/Time Footer inside box
      const lineY = cursorY + 21.5;
      doc.setDrawColor(...BORDER);
      doc.line(areaX, lineY, areaX + areaW, lineY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const displayName = isSigned
        ? signature.signerName || fallbackName
        : fallbackName || '________________________';
      drawPdfText(doc, `${nameLabel}: ${displayName.substring(0, 32)}`, areaX, lineY + 3.8, {
        color: SLATE_600,
      });

      const displayDateTime =
        isSigned && signature.signedAt
          ? formatDateTimeInTimeZone(signature.signedAt, tz)
          : 'Pending';
      drawPdfText(doc, `Date & Time: ${displayDateTime}`, areaX, lineY + 7.8, {
        color: SLATE_600,
      });
    };

    renderSignatureBox(marginX, 'MANAGER SIGNATURE', session.managerSignature, '', 'Manager Name');

    renderSignatureBox(
      marginX + sigBoxWidth + sigGap,
      'RECEIVED BY – CHEF / STAFF',
      session.receiverSignature,
      session.receivedByName || '',
      'Chef/Staff Name'
    );

    cursorY += sigBoxHeight + 7;
  });

  // -------------------------------------------------------------------------
  // 4. FINAL REPORT SUMMARY BLOCK
  // -------------------------------------------------------------------------
  if (orderedSessions.length > 0) {
    if (cursorY + 20 > usableBottomY) {
      cursorY = startNewPage('Report Summary');
    }

    doc.setFillColor(...NAVY);
    doc.roundedRect(marginX, cursorY, contentWidth, 16, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    drawPdfText(doc, 'REPORT SUMMARY', marginX + 4, cursorY + 5.5, { color: ORANGE });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    drawPdfText(
      doc,
      `Period: ${dateRange.label}  |  Sessions: ${totalSessions}  |  Items Issued: ${totalItemsIssued}`,
      marginX + 4,
      cursorY + 11.8,
      { color: [255, 255, 255] }
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.8);
    drawPdfText(
      doc,
      `Grand Total: ${formatInrAmount(grandTotalValue, currencySymbol)}`,
      marginX + contentWidth - 4,
      cursorY + 10.5,
      { align: 'right', color: [255, 255, 255] }
    );
  }

  // -------------------------------------------------------------------------
  // 5. UNIFIED STOQO FOOTER ON EVERY PAGE (Restaurant Name + Generated + Page X of Y)
  // -------------------------------------------------------------------------
  applyStoqoPageFooters(doc, headerOptions);

  return doc;
}

/**
 * Generates and downloads the combined Store to Kitchen Issue Report PDF for the selected period.
 */
export function downloadStoreToKitchenIssuePdf(options: IssueReportPdfOptions): void {
  const doc = buildStoreToKitchenIssuePdf(options);
  const safeName = (options.restaurantName || 'STOQO')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const rangeSlug =
    options.dateRange.startDateKey === options.dateRange.endDateKey
      ? options.dateRange.startDateKey
      : `${options.dateRange.startDateKey}_to_${options.dateRange.endDateKey}`;
  doc.save(`STOQO_Issue_Report_${safeName}_${rangeSlug}.pdf`);
}
