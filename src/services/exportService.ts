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
