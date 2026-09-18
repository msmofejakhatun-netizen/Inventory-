import { createCanvas } from '@napi-rs/canvas';
import {
  calculatePoImageDimensions,
  drawExcelPoSheet,
  PoImageData,
  PoImageItem,
} from '../src/utils/excelPoImage';
import { PurchaseOrder } from '../src/types';

/**
 * Server-side high-resolution Excel-style Purchase Order PNG generator
 * Uses @napi-rs/canvas to create the exact same image as the client-side canvas.
 */
export function generateServerPoImageBuffer(
  po: PurchaseOrder,
  restaurantName: string
): { buffer: Buffer; filename: string } {
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

  const canvas = createCanvas(layout.width * layout.scale, layout.height * layout.scale);
  const ctx = canvas.getContext('2d');

  drawExcelPoSheet(ctx, data, layout);

  const buffer = canvas.toBuffer('image/png');

  const cleanPoNum = (po.poNumber || 'PO').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanVendor = (po.vendorName || 'VENDOR')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 20);
  const filename = `PO_${cleanPoNum}_${cleanVendor}.png`;

  return { buffer, filename };
}
