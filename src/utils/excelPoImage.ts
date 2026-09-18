/**
 * Pure 2D Canvas Excel-style Purchase Order image generator
 * Renders an authentic, crisp spreadsheet-style table image suitable for WhatsApp.
 * Compatible with both browser HTMLCanvasElement and server-side @napi-rs/canvas.
 */

export interface PoImageItem {
  itemName: string;
  orderedQty: number;
  unit: string;
}

export interface PoImageData {
  restaurantName: string;
  vendorName: string;
  poNumber: string;
  poDate: string;
  items: PoImageItem[];
}

export interface RenderLayout {
  width: number;
  height: number;
  scale: number;
}

const BASE_WIDTH = 800;
const PADDING = 36;
const HEADER_HEIGHT = 160;
const TABLE_HEADER_HEIGHT = 44;
const ROW_HEIGHT = 38;
const FOOTER_HEIGHT = 50;

/**
 * Calculates the exact dynamic canvas dimensions based on the number of items.
 * Ensures that 5 items, 50 items, or any number of items fit completely without cropping.
 */
export function calculatePoImageDimensions(itemCount: number, scale = 2): RenderLayout {
  const contentHeight =
    PADDING +
    HEADER_HEIGHT +
    TABLE_HEADER_HEIGHT +
    Math.max(1, itemCount) * ROW_HEIGHT +
    FOOTER_HEIGHT +
    PADDING;

  return {
    width: BASE_WIDTH,
    height: Math.ceil(contentHeight),
    scale,
  };
}

/**
 * Draws the Excel-style Purchase Order onto any standard 2D Canvas context.
 */
export function drawExcelPoSheet(
  ctx: any,
  data: PoImageData,
  layout: RenderLayout
): void {
  const { width, height, scale } = layout;

  ctx.save();
  ctx.scale(scale, scale);

  // 1. Crisp white background (like an Excel sheet)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  const tableLeft = PADDING;
  const tableWidth = width - PADDING * 2;
  const tableRight = tableLeft + tableWidth;

  // 2. Excel Outer Container Border
  ctx.strokeStyle = '#94A3B8'; // Slate-400
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tableLeft, PADDING, tableWidth, height - PADDING * 2);

  // -------------------------------------------------------------
  // TOP HEADER SECTION (Restaurant Name, Vendor, PO #, Date)
  // -------------------------------------------------------------
  const headerY = PADDING + 28;

  // Top: RESTAURANT NAME (Large, bold, prominent)
  ctx.fillStyle = '#0F172A'; // Slate-900
  ctx.font = 'bold 22px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const cleanRestName = (data.restaurantName || 'RESTAURANT STORE').toUpperCase();
  ctx.fillText(cleanRestName, tableLeft + 18, headerY);

  // Subtitle / Document Type
  ctx.fillStyle = '#475569'; // Slate-600
  ctx.font = 'bold 12px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('PURCHASE ORDER', tableRight - 18, headerY + 4);

  // Divider line inside header
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tableLeft + 18, headerY + 34);
  ctx.lineTo(tableRight - 18, headerY + 34);
  ctx.stroke();

  // Row 2: VENDOR NAME (Left) & PO NUMBER (Right)
  const metaY1 = headerY + 46;

  ctx.fillStyle = '#64748B'; // Label gray
  ctx.font = 'bold 11px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('VENDOR / SUPPLIER:', tableLeft + 18, metaY1);

  ctx.fillStyle = '#0F172A'; // Value dark
  ctx.font = 'bold 15px Arial, "Segoe UI", Helvetica, sans-serif';
  const cleanVendor = (data.vendorName || 'SUPPLIER').toUpperCase();
  ctx.fillText(cleanVendor, tableLeft + 18, metaY1 + 16);

  // PO Number on the right
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 11px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('PO NUMBER:', tableRight - 18, metaY1);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 15px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.fillText(data.poNumber || 'PO-0000', tableRight - 18, metaY1 + 16);

  // Row 3: DATE
  const metaY2 = metaY1 + 42;
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 11px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('DATE:', tableRight - 18, metaY2);

  ctx.fillStyle = '#1E293B';
  ctx.font = '600 13px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.fillText(data.poDate || new Date().toISOString().slice(0, 10), tableRight - 18, metaY2 + 15);

  // -------------------------------------------------------------
  // MAIN EXCEL-STYLE TABLE (ITEM | QTY | UNIT)
  // -------------------------------------------------------------
  const tableStartY = PADDING + HEADER_HEIGHT;

  // Column definitions
  // Total tableWidth = 728px (800 - 72)
  const colItemWidth = Math.floor(tableWidth * 0.60); // 436px
  const colQtyWidth = Math.floor(tableWidth * 0.20);  // 146px
  const colUnitWidth = tableWidth - colItemWidth - colQtyWidth; // 146px

  const colItemX = tableLeft;
  const colQtyX = colItemX + colItemWidth;
  const colUnitX = colQtyX + colQtyWidth;

  // Table Header Background (Excel soft grey-blue band)
  ctx.fillStyle = '#F1F5F9'; // Slate-100
  ctx.fillRect(tableLeft, tableStartY, tableWidth, TABLE_HEADER_HEIGHT);

  // Header bottom border
  ctx.strokeStyle = '#475569'; // Slate-600 strong border
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tableLeft, tableStartY + TABLE_HEADER_HEIGHT);
  ctx.lineTo(tableRight, tableStartY + TABLE_HEADER_HEIGHT);
  ctx.stroke();

  // Header top border
  ctx.beginPath();
  ctx.moveTo(tableLeft, tableStartY);
  ctx.lineTo(tableRight, tableStartY);
  ctx.stroke();

  // Header column text
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 13px Arial, "Segoe UI", Helvetica, sans-serif';

  // ITEM header
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ITEM', colItemX + 16, tableStartY + TABLE_HEADER_HEIGHT / 2);

  // QTY header (right aligned or center)
  ctx.textAlign = 'right';
  ctx.fillText('QTY', colQtyX + colQtyWidth - 20, tableStartY + TABLE_HEADER_HEIGHT / 2);

  // UNIT header (center aligned)
  ctx.textAlign = 'center';
  ctx.fillText('UNIT', colUnitX + colUnitWidth / 2, tableStartY + TABLE_HEADER_HEIGHT / 2);

  // Vertical column borders for header
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(colQtyX, tableStartY);
  ctx.lineTo(colQtyX, tableStartY + TABLE_HEADER_HEIGHT);
  ctx.moveTo(colUnitX, tableStartY);
  ctx.lineTo(colUnitX, tableStartY + TABLE_HEADER_HEIGHT);
  ctx.stroke();

  // -------------------------------------------------------------
  // DATA ROWS
  // -------------------------------------------------------------
  const items = data.items && data.items.length > 0 ? data.items : [];
  let currentY = tableStartY + TABLE_HEADER_HEIGHT;

  items.forEach((item, index) => {
    const isEven = index % 2 === 0;

    // Row background (white or very subtle zebra)
    ctx.fillStyle = isEven ? '#FFFFFF' : '#F8FAFC';
    ctx.fillRect(tableLeft, currentY, tableWidth, ROW_HEIGHT);

    // Row horizontal bottom border
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tableLeft, currentY + ROW_HEIGHT);
    ctx.lineTo(tableRight, currentY + ROW_HEIGHT);
    ctx.stroke();

    // Vertical column gridlines
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(colQtyX, currentY);
    ctx.lineTo(colQtyX, currentY + ROW_HEIGHT);
    ctx.moveTo(colUnitX, currentY);
    ctx.lineTo(colUnitX, currentY + ROW_HEIGHT);
    ctx.stroke();

    const textBaselineY = currentY + ROW_HEIGHT / 2;

    // ITEM Name
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 13px Arial, "Segoe UI", Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Truncate if extreme length, with nice padding
    let itemName = (item.itemName || 'ITEM').toUpperCase().trim();
    const maxItemWidth = colItemWidth - 32;
    if (ctx.measureText(itemName).width > maxItemWidth) {
      while (itemName.length > 3 && ctx.measureText(itemName + '...').width > maxItemWidth) {
        itemName = itemName.slice(0, -1);
      }
      itemName = itemName + '...';
    }
    ctx.fillText(itemName, colItemX + 16, textBaselineY);

    // QTY
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 14px Arial, "Segoe UI", Helvetica, sans-serif';
    ctx.textAlign = 'right';
    const qtyText = String(item.orderedQty ?? 0);
    ctx.fillText(qtyText, colQtyX + colQtyWidth - 20, textBaselineY);

    // UNIT
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 12px Arial, "Segoe UI", Helvetica, sans-serif';
    ctx.textAlign = 'center';
    const unitText = (item.unit || 'UNIT').toUpperCase().trim();
    ctx.fillText(unitText, colUnitX + colUnitWidth / 2, textBaselineY);

    currentY += ROW_HEIGHT;
  });

  // Table bottom border
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tableLeft, currentY);
  ctx.lineTo(tableRight, currentY);
  ctx.stroke();

  // -------------------------------------------------------------
  // FOOTER SUMMARY
  // -------------------------------------------------------------
  const footerY = currentY + 16;
  ctx.fillStyle = '#64748B';
  ctx.font = '600 12px Arial, "Segoe UI", Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`TOTAL ITEMS: ${items.length}`, tableLeft + 16, footerY);

  ctx.textAlign = 'right';
  ctx.fillText('Generated via Restaurant Store Control', tableRight - 16, footerY);

  ctx.restore();
}

/**
 * Client-side browser helper to generate PNG Blob and Data URL
 */
export async function generateClientPoImage(
  po: {
    poNumber: string;
    createdAt?: string;
    vendorName?: string;
    items?: Array<{
      itemName: string;
      orderedQty?: number;
      recommendedQuantity?: number;
      unit: string;
    }>;
  },
  restaurantName: string
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  const items: PoImageItem[] = (po.items || []).map((it) => ({
    itemName: it.itemName,
    orderedQty: it.orderedQty ?? it.recommendedQuantity ?? 0,
    unit: it.unit || 'UNIT',
  }));

  const poDate = po.createdAt
    ? new Date(po.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

  const data: PoImageData = {
    restaurantName: restaurantName || 'Restaurant Store Control',
    vendorName: po.vendorName || 'Supplier',
    poNumber: po.poNumber || 'PO',
    poDate,
    items,
  };

  const layout = calculatePoImageDimensions(items.length, 2);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width * layout.scale;
  canvas.height = layout.height * layout.scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available in browser');
  }

  drawExcelPoSheet(ctx, data, layout);

  const dataUrl = canvas.toDataURL('image/png');

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to create PNG blob from canvas'));
    }, 'image/png');
  });

  const cleanPoNum = (po.poNumber || 'PO').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanVendor = (po.vendorName || 'VENDOR')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 20);
  const filename = `PO_${cleanPoNum}_${cleanVendor}.png`;

  return { blob, dataUrl, filename };
}
