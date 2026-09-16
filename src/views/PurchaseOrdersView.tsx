import React, { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Download,
  CheckCircle,
  Clock,
  Printer,
  Trash2,
  Building2,
  Boxes,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { PurchaseOrder, Vendor, Item, PurchaseOrderItem } from '../types';
import { calculate15DayPurchaseRequirement, calculateAverageDailyConsumption } from '../services/calculations';
import { exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const PurchaseOrdersView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // New PO Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubOrders = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setOrders(snap.docs.map((d) => d.data() as PurchaseOrder));
        setLoading(false);
      }
    );

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
    });

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    return () => {
      unsubOrders();
      unsubVendors();
      unsubItems();
    };
  }, [activeRestaurantId]);

  const openCreatePoModal = () => {
    const firstVendor = vendors[0];
    setSelectedVendorId(firstVendor?.id || '');
    loadVendorItems(firstVendor?.id || '');
    setIsModalOpen(true);
  };

  const loadVendorItems = (vendorId: string) => {
    // Populate items matching this primary vendor or all items
    const vendorItems = items.filter((i) => !vendorId || i.primaryVendorId === vendorId);
    const candidateItems = vendorItems.length > 0 ? vendorItems : items.slice(0, 5);

    const initialRows: PurchaseOrderItem[] = candidateItems.map((item) => {
      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const target = item.maximumStock || item.minimumStock * 2 || 10;
      const needed = Math.max(0, target - item.currentStock);
      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        recommendedQuantity: needed > 0 ? needed : 5,
        estimatedRate: rate,
        estimatedAmount: Number(((needed > 0 ? needed : 5) * rate).toFixed(2)),
        reason: 'Restocking cycle',
      };
    });
    setPoItems(initialRows);
  };

  const handleVendorChange = (vId: string) => {
    setSelectedVendorId(vId);
    loadVendorItems(vId);
  };

  const updateItemQty = (idx: number, qty: number) => {
    const updated = [...poItems];
    const row = updated[idx];
    row.recommendedQuantity = Number(qty) || 0;
    row.estimatedAmount = Number((row.recommendedQuantity * row.estimatedRate).toFixed(2));
    updated[idx] = row;
    setPoItems(updated);
  };

  const removeItemRow = (idx: number) => {
    if (poItems.length > 1) {
      setPoItems(poItems.filter((_, i) => i !== idx));
    }
  };

  const totalEstimated = poItems.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const handleSavePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !selectedVendorId || poItems.length === 0) return;

    const vendorObj = vendors.find((v) => v.id === selectedVendorId);
    const now = new Date().toISOString();
    const poRef = doc(collection(db, 'restaurants', activeRestaurantId, 'purchaseOrders'));

    try {
      setSubmitting(true);
      const newPo: PurchaseOrder = {
        id: poRef.id,
        poNumber: `PO-${Date.now().toString().slice(-6)}`,
        vendorId: selectedVendorId,
        vendorName: vendorObj?.name || 'Vendor',
        status: 'DRAFT',
        totalEstimatedAmount: totalEstimated,
        items: poItems,
        restaurantId: activeRestaurantId,
        createdAt: now,
      };

      await setDoc(poRef, newPo);
      setIsModalOpen(false);
    } catch (e) {
      console.error('Failed to create PO:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const updatePoStatus = async (poId: string, newStatus: PurchaseOrder['status']) => {
    if (!activeRestaurantId) return;
    try {
      const poRef = doc(db, 'restaurants', activeRestaurantId, 'purchaseOrders', poId);
      await updateDoc(poRef, { status: newStatus });
    } catch (e) {
      console.error('Failed to update PO status:', e);
    }
  };

  const printPoPdf = (po: PurchaseOrder) => {
    const headers = ['Item Name', 'Unit', 'Ordered Qty', 'Est. Rate', 'Est. Amount'];
    const rows = po.items.map((i) => [
      i.itemName,
      i.unit,
      i.recommendedQuantity,
      `${currencySymbol}${i.estimatedRate}`,
      `${currencySymbol}${i.estimatedAmount}`,
    ]);
    exportToPdf(`Purchase Order ${po.poNumber} (${po.vendorName})`, activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Supplier-Wise Purchase Orders (PO)</h1>
            <Badge variant="neutral" size="sm">
              {orders.length} Orders
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Generate formal supplier purchase orders grouped by vendor with print-ready PDF export.
          </p>
        </div>

        <button
          id="create-po-btn"
          onClick={openCreatePoModal}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Purchase Order
        </button>
      </div>

      {/* Orders Grid */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12 text-stone-400 text-xs">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center text-stone-400">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-stone-300" />
            <p className="text-sm font-semibold text-stone-700">No Purchase Orders Created Yet</p>
            <p className="text-xs text-stone-400 mt-1">
              Consolidate required stock from the 15-Day Planner or create a supplier PO manually.
            </p>
          </div>
        ) : (
          orders.map((po) => (
            <div
              key={po.id}
              className="bg-white rounded-xl border border-stone-200 p-5 shadow-2xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-stone-100">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-stone-900 text-sm">{po.poNumber}</span>
                  <span className="text-xs font-semibold text-stone-700">• {po.vendorName}</span>
                  <Badge
                    variant={
                      po.status === 'FULFILLED'
                        ? 'success'
                        : po.status === 'SENT'
                        ? 'info'
                        : 'warning'
                    }
                    size="sm"
                  >
                    {po.status}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => printPoPdf(po)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-200 hover:bg-stone-50 rounded-md text-stone-700 font-medium"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print / PDF
                  </button>
                  {po.status === 'DRAFT' && (
                    <button
                      onClick={() => updatePoStatus(po.id, 'SENT')}
                      className="px-2.5 py-1 text-xs bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-md font-medium"
                    >
                      Mark as Sent
                    </button>
                  )}
                  {po.status === 'SENT' && (
                    <button
                      onClick={() => updatePoStatus(po.id, 'FULFILLED')}
                      className="px-2.5 py-1 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-medium"
                    >
                      Mark as Fulfilled
                    </button>
                  )}
                </div>
              </div>

              {/* Items List in PO */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-stone-600">
                  <thead className="text-[10px] uppercase text-stone-400 border-b border-stone-100">
                    <tr>
                      <th className="py-1 px-2">Item</th>
                      <th className="py-1 px-2 text-right">Order Qty</th>
                      <th className="py-1 px-2 text-right">Est. Rate</th>
                      <th className="py-1 px-2 text-right">Est. Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {po.items.map((item, i) => (
                      <tr key={i}>
                        <td className="py-2 px-2 font-medium text-stone-800">{item.itemName}</td>
                        <td className="py-2 px-2 text-right font-bold text-stone-900">
                          {item.recommendedQuantity} {item.unit}
                        </td>
                        <td className="py-2 px-2 text-right text-stone-600">
                          {currencySymbol}{item.estimatedRate.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold text-stone-900">
                          {currencySymbol}{item.estimatedAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-stone-100">
                <span className="text-stone-400">Created on {new Date(po.createdAt).toLocaleDateString()}</span>
                <span className="font-bold text-stone-900 text-sm">
                  Total Value: {currencySymbol}{po.totalEstimatedAmount.toFixed(2)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create PO Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create Purchase Order"
        subtitle="Group requirements and generate formal supplier order"
        maxWidth="2xl"
      >
        <form onSubmit={handleSavePo} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Select Supplier / Vendor *
            </label>
            <select
              required
              value={selectedVendorId}
              onChange={(e) => handleVendorChange(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Items selection */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="p-3 bg-stone-50 border-b border-stone-200">
              <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Order Items ({poItems.length})
              </h4>
            </div>

            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
              {poItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 text-xs p-2 rounded-lg border border-stone-100 bg-white">
                  <div className="flex-1">
                    <p className="font-semibold text-stone-900">{item.itemName}</p>
                    <p className="text-[10px] text-stone-400">Rate: {currencySymbol}{item.estimatedRate} / {item.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0.1}
                      step="any"
                      value={item.recommendedQuantity}
                      onChange={(e) => updateItemQty(idx, Number(e.target.value))}
                      className="w-20 px-2 py-1 text-xs border border-stone-300 rounded-md text-right font-bold"
                    />
                    <span className="text-stone-500 w-8">{item.unit}</span>
                    <span className="font-bold text-stone-900 w-24 text-right">
                      {currencySymbol}{item.estimatedAmount}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      className="p-1 text-stone-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-stone-50 border-t border-stone-200 flex justify-between items-center text-xs">
              <span className="font-bold text-stone-700">Estimated Total:</span>
              <span className="text-sm font-black text-stone-900">
                {currencySymbol}{totalEstimated.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Generating...' : 'Save Purchase Order'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
