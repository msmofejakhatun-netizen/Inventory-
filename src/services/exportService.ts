import jsPDF from 'jspdf';

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

export function exportToPdf(
  title: string,
  restaurantName: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('RESTAURANT STORE CONTROL SYSTEM', 14, 18);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${restaurantName.toUpperCase()}`, 14, 25);
  doc.text(`Report: ${title}`, 14, 32);

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 38);
  doc.text('Confidential Restaurant Operational Data', pageWidth - 75, 38);
  doc.line(14, 41, pageWidth - 14, 41);

  // Table rendering
  doc.setTextColor(20);
  let startY = 48;
  const colWidth = (pageWidth - 28) / headers.length;

  // Header row
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  headers.forEach((h, i) => {
    doc.text(String(h), 14 + i * colWidth, startY);
  });
  doc.line(14, startY + 2, pageWidth - 14, startY + 2);
  startY += 7;

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  rows.slice(0, 35).forEach((row) => {
    if (startY > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      startY = 20;
    }
    row.forEach((cell, i) => {
      const text = String(cell ?? '');
      doc.text(text.substring(0, 22), 14 + i * colWidth, startY);
    });
    startY += 6;
  });

  if (rows.length > 35) {
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`... and ${rows.length - 35} more records`, 14, startY + 4);
  }

  doc.save(`${title.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportPurchaseOrderPdf(
  po: import('../types').PurchaseOrder,
  restaurantName: string,
  currencySymbol: string = '₹',
  restaurantAddress?: string
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Document Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('PURCHASE ORDER', 14, 20);

  // Status Badge
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const statusColors: Record<string, [number, number, number]> = {
    DRAFT: [120, 113, 108],
    PENDING_SEND: [217, 119, 6],
    SENT: [22, 163, 74],
    RECEIVED: [13, 148, 136],
    PARTIALLY_RECEIVED: [37, 99, 235],
    CANCELLED: [220, 38, 38],
  };
  const badgeColor = statusColors[po.status] || [100, 100, 100];
  doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.text(`STATUS: ${po.status}`, pageWidth - 60, 20);

  // Restaurant details
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(restaurantName.toUpperCase(), 14, 28);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  if (restaurantAddress) {
    doc.text(restaurantAddress, 14, 33);
  }
  doc.text(`PO Date: ${new Date(po.createdAt).toLocaleDateString()} ${new Date(po.createdAt).toLocaleTimeString()}`, 14, 38);

  // PO & Vendor Details Card
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.rect(14, 42, pageWidth - 28, 26, 'FD');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`PO Number: ${po.poNumber}`, 18, 49);
  doc.text(`Supplier: ${po.vendorName}`, 18, 56);
  if (po.vendorPhone) {
    doc.text(`Phone: ${po.vendorPhone}`, 18, 63);
  }

  const rightColX = pageWidth / 2 + 10;
  if (po.sentAt) {
    doc.text(`Sent Date: ${new Date(po.sentAt).toLocaleString()}`, rightColX, 49);
  }
  if (po.receivedAt) {
    doc.text(`Received Date: ${new Date(po.receivedAt).toLocaleString()}`, rightColX, 56);
  }
  if (po.billNumber) {
    doc.text(`Invoice / Bill No: ${po.billNumber}`, rightColX, 63);
  }

  // Table Headers
  let startY = 76;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, startY - 5, pageWidth - 28, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);

  const isReceivedView = po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED';
  doc.text('#', 16, startY);
  doc.text('Item Description', 24, startY);
  doc.text('Ordered', 90, startY);
  if (isReceivedView) {
    doc.text('Recv', 110, startY);
    doc.text('Missing', 125, startY);
    doc.text('Actual Rate', 145, startY);
    doc.text('Actual Amt', pageWidth - 35, startY);
  } else {
    doc.text('Est. Rate', 130, startY);
    doc.text('Est. Amount', pageWidth - 35, startY);
  }
  doc.line(14, startY + 2, pageWidth - 14, startY + 2);
  startY += 7;

  // Items
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  po.items.forEach((item, index) => {
    if (startY > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      startY = 20;
    }
    const ordered = item.orderedQty ?? item.recommendedQuantity ?? 0;
    const estRate = item.estimatedRate ?? 0;
    const estAmt = item.estimatedAmount ?? (ordered * estRate);

    doc.text(String(index + 1), 16, startY);
    doc.text(item.itemName.substring(0, 32), 24, startY);
    doc.text(`${ordered} ${item.unit}`, 90, startY);

    if (isReceivedView) {
      doc.text(`${item.receivedQty ?? 0} ${item.unit}`, 110, startY);
      doc.text(`${item.missingQty ?? 0} ${item.unit}`, 125, startY);
      doc.text(`${currencySymbol}${(item.actualRate ?? estRate).toFixed(2)}`, 145, startY);
      doc.text(`${currencySymbol}${(item.actualAmount ?? (item.receivedQty ?? 0) * (item.actualRate ?? estRate)).toFixed(2)}`, pageWidth - 35, startY);
    } else {
      doc.text(`${currencySymbol}${estRate.toFixed(2)}`, 130, startY);
      doc.text(`${currencySymbol}${estAmt.toFixed(2)}`, pageWidth - 35, startY);
    }
    startY += 6;
  });

  // Totals Box
  startY += 4;
  doc.line(14, startY, pageWidth - 14, startY);
  startY += 7;

  const totalEst = po.estimatedTotal ?? po.totalEstimatedAmount ?? 0;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Estimated Value:`, pageWidth - 90, startY);
  doc.text(`${currencySymbol}${totalEst.toFixed(2)}`, pageWidth - 35, startY);

  if (isReceivedView && po.actualReceivedTotal) {
    startY += 6;
    doc.setTextColor(13, 148, 136);
    doc.text(`Total Received Value:`, pageWidth - 90, startY);
    doc.text(`${currencySymbol}${po.actualReceivedTotal.toFixed(2)}`, pageWidth - 35, startY);
  }

  // Footer / Notes
  startY += 20;
  if (startY > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    startY = 20;
  }
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text('Generated via Restaurant Store Control System. All rates subject to invoice verification upon store entry.', 14, startY);
  doc.text('Authorized Signature / Store Manager: _______________________________', 14, startY + 12);

  doc.save(`${po.poNumber}_${po.vendorName.replace(/\s+/g, '_')}.pdf`);
}
