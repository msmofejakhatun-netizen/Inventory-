import React, { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Plus,
  Trash2,
  AlertTriangle,
  TrendingUp,
  ShieldAlert,
  Calendar,
  FileText,
  Search,
  CheckCircle2,
  Download,
  Info,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Vendor, Purchase, PurchaseItemRow, Department } from '../types';
import {
  calculateWeightedAverageCost,
  calculateAverageDailyConsumption,
  calculateExcessStock,
} from '../services/calculations';
import { executePurchaseTransaction } from '../services/restaurantService';
import { exportToPdf, exportToCsv } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const PurchasesView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  // New Purchase Form Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [rows, setRows] = useState<
    {
      itemId: string;
      quantity: number;
      rate: number;
      taxPercent: number;
    }[]
  >([]);

  // Override purchase safeguard
  const [isOverride, setIsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterVendorId, setFilterVendorId] = useState('ALL');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubPurchases = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'purchases'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setPurchases(snap.docs.map((d) => d.data() as Purchase));
        setLoading(false);
      }
    );

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      const list = snap.docs.map((d) => d.data() as Vendor);
      setVendors(list);
    });

    return () => {
      unsubPurchases();
      unsubItems();
      unsubVendors();
    };
  }, [activeRestaurantId]);

  const openNewPurchaseModal = () => {
    setBillNumber('');
    setBillDate(new Date().toISOString().slice(0, 10));
    setSelectedVendorId(vendors[0]?.id || '');
    setRows([{ itemId: items[0]?.id || '', quantity: 1, rate: items[0]?.lastPurchaseRate || 0, taxPercent: 5 }]);
    setIsOverride(false);
    setOverrideReason('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const addRow = () => {
    const firstItem = items[0];
    setRows([
      ...rows,
      {
        itemId: firstItem?.id || '',
        quantity: 1,
        rate: firstItem?.lastPurchaseRate || 0,
        taxPercent: 5,
      },
    ]);
  };

  const removeRow = (index: number) => {
    if (rows.length > 1) {
      setRows(rows.filter((_, i) => i !== index));
    }
  };

  const updateRow = (index: number, field: string, value: any) => {
    const newRows = [...rows];
    const currentRow = { ...newRows[index], [field]: value };

    // If item changed, default rate to item's last rate
    if (field === 'itemId') {
      const selected = items.find((i) => i.id === value);
      if (selected) {
        currentRow.rate = selected.lastPurchaseRate || selected.averageStockRate || 0;
      }
    }

    newRows[index] = currentRow;
    setRows(newRows);
  };

  // Process rows with AI Price Guard & Purchase Protection calculations
  const analyzedRows: PurchaseItemRow[] = rows.map((r) => {
    const item = items.find((i) => i.id === r.itemId);
    const prevRate = item?.lastPurchaseRate || 0;
    const currentRate = Number(r.rate) || 0;
    const qty = Number(r.quantity) || 0;
    const hikeAbs = currentRate - prevRate;
    const hikePct = prevRate > 0 ? Number(((hikeAbs / prevRate) * 100).toFixed(2)) : 0;
    const isPriceHike = hikeAbs > 0 && prevRate > 0;

    // Check if stock is above target
    const currentStock = item?.currentStock || 0;
    const targetDays = item?.targetStockDays || 5;
    const isAboveTarget = Boolean(
      item?.maximumStock && currentStock >= item.maximumStock
    );

    return {
      itemId: r.itemId,
      itemName: item?.name || 'Unknown Item',
      category: item?.category || 'General',
      unit: item?.unit || 'Unit',
      quantity: qty,
      rate: currentRate,
      taxPercent: Number(r.taxPercent) || 0,
      total: Number((qty * currentRate).toFixed(2)),
      previousRate: prevRate,
      priceHikeAbsolute: Number(hikeAbs.toFixed(2)),
      priceHikePercent: hikePct,
      isPriceHike,
      currentStock,
      targetStockDays: targetDays,
      isAboveTarget,
    };
  });

  const totalAmount = analyzedRows.reduce((sum, r) => sum + r.total, 0);
  const taxAmount = analyzedRows.reduce((sum, r) => sum + (r.total * r.taxPercent) / 100, 0);
  const netAmount = Number((totalAmount + taxAmount).toFixed(2));

  // Determine if any item triggers the Purchase Protection safeguard
  const hasAboveTargetItems = analyzedRows.some((r) => r.isAboveTarget);

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!activeRestaurantId) return;
    if (!billNumber.trim()) {
      setFormError('Please enter the vendor Bill / Invoice Number.');
      return;
    }
    if (!selectedVendorId) {
      setFormError('Please select a vendor.');
      return;
    }
    if (analyzedRows.length === 0) {
      setFormError('Please add at least one item.');
      return;
    }

    // Purchase Protection Guard enforcement
    if (hasAboveTargetItems && (!isOverride || !overrideReason.trim())) {
      setFormError(
        'Purchase Protection: One or more items already have stock above target. You must check "Override Purchase" and enter an explanation.'
      );
      return;
    }

    const vendorObj = vendors.find((v) => v.id === selectedVendorId);

    try {
      setSubmitting(true);
      await executePurchaseTransaction(
        activeRestaurantId,
        {
          billNumber: billNumber.trim(),
          billDate,
          vendorId: selectedVendorId,
          vendorName: vendorObj?.name || 'Vendor',
          totalAmount,
          taxAmount,
          netAmount,
          paymentStatus: 'unpaid',
          isOverride,
          overrideReason: isOverride ? overrideReason.trim() : undefined,
          items: analyzedRows,
          recordedByUid: user?.uid || 'staff',
          recordedByName: userProfile?.name || user?.displayName || 'Staff',
        },
        activeRestaurant?.priceHikeThresholdPercent || 2.0
      );

      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Purchase submission failed:', err);
      setFormError(err?.message || 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPurchases = purchases.filter((p) => {
    const matchSearch =
      p.billNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.vendorName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchVendor = filterVendorId === 'ALL' || p.vendorId === filterVendorId;
    return matchSearch && matchVendor;
  });

  const handleExportCsv = () => {
    const headers = ['Bill Number', 'Bill Date', 'Vendor', 'Items Count', 'Net Amount', 'Status', 'Override'];
    const rows = filteredPurchases.map((p) => [
      p.billNumber,
      p.billDate,
      p.vendorName,
      p.itemsCount,
      p.netAmount,
      p.paymentStatus,
      p.isOverride ? `Yes (${p.overrideReason})` : 'No',
    ]);
    exportToCsv(`purchases_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Bill #', 'Date', 'Vendor', 'Items', 'Net Amount', 'Status'];
    const rows = filteredPurchases.map((p) => [
      p.billNumber,
      p.billDate,
      p.vendorName,
      p.itemsCount,
      `${currencySymbol}${p.netAmount}`,
      p.paymentStatus,
    ]);
    exportToPdf('Inward Purchases Ledger', activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Inward Purchases & Invoices</h1>
            <Badge variant="neutral" size="sm">
              Weighted Average Costing
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Receive goods, auto-recalculate average inventory rates, and guard against vendor price hikes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="new-purchase-btn"
            onClick={openNewPurchaseModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Record Inward Bill
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <FileText className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="purchase-search-input"
            type="text"
            placeholder="Search by bill number or vendor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        <select
          value={filterVendorId}
          onChange={(e) => setFilterVendorId(e.target.value)}
          className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-amber-500 text-stone-700 w-full md:w-auto"
        >
          <option value="ALL">All Vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      {/* Purchases List */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Bill Number</th>
                <th className="py-3 px-4">Bill Date</th>
                <th className="py-3 px-4">Vendor</th>
                <th className="py-3 px-4">Items Included</th>
                <th className="py-3 px-4 text-right">Net Amount</th>
                <th className="py-3 px-4">Payment Status</th>
                <th className="py-3 px-4">Safeguard Override</th>
                <th className="py-3 px-4">Recorded By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-stone-400">
                    Loading purchases...
                  </td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-stone-400">
                    No inward purchase bills recorded yet.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-stone-900 font-mono">{p.billNumber}</td>
                    <td className="py-3 px-4 text-stone-600">{p.billDate}</td>
                    <td className="py-3 px-4 font-semibold text-stone-800">{p.vendorName}</td>
                    <td className="py-3 px-4 text-stone-600">
                      {p.items?.map((i) => `${i.itemName} (${i.quantity} ${i.unit})`).join(', ') || `${p.itemsCount} items`}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {currencySymbol}{p.netAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={p.paymentStatus === 'paid' ? 'success' : 'warning'} size="sm">
                        {p.paymentStatus.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {p.isOverride ? (
                        <span className="text-[11px] text-amber-700 font-medium">
                          Override: {p.overrideReason}
                        </span>
                      ) : (
                        <span className="text-stone-400 text-[11px]">Normal</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-stone-500 text-[11px]">{p.recordedByName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Inward Bill Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Record Inward Purchase Bill"
        subtitle="Recalculates Weighted Average Cost & verifies price hike thresholds"
        maxWidth="3xl"
      >
        <form onSubmit={handleSubmitPurchase} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Vendor *
              </label>
              <select
                required
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Bill / Invoice Number *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. INV-88219"
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden mt-4">
            <div className="p-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Inward Items
              </h4>
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1 text-xs text-amber-700 font-bold hover:text-amber-900"
              >
                <Plus className="w-3.5 h-3.5" /> Add Another Item
              </button>
            </div>

            <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
              {rows.map((row, idx) => {
                const analyzed = analyzedRows[idx];
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border border-stone-200 bg-white space-y-2 text-xs shadow-2xs"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <div className="sm:col-span-4">
                        <label className="text-[10px] text-stone-500 font-semibold uppercase block mb-1">
                          Item
                        </label>
                        <select
                          value={row.itemId}
                          onChange={(e) => updateRow(idx, 'itemId', e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-stone-300 rounded-md bg-white text-xs font-medium"
                        >
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unit})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-stone-500 font-semibold uppercase block mb-1">
                          Qty ({analyzed.unit})
                        </label>
                        <input
                          type="number"
                          min={0.01}
                          step="any"
                          value={row.quantity}
                          onChange={(e) => updateRow(idx, 'quantity', Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-stone-300 rounded-md text-xs font-bold"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-stone-500 font-semibold uppercase block mb-1">
                          Rate ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={row.rate}
                          onChange={(e) => updateRow(idx, 'rate', Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-stone-300 rounded-md text-xs font-bold"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-stone-500 font-semibold uppercase block mb-1">
                          Tax %
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={row.taxPercent}
                          onChange={(e) => updateRow(idx, 'taxPercent', Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-stone-300 rounded-md text-xs"
                        />
                      </div>

                      <div className="sm:col-span-1 text-right">
                        <label className="text-[10px] text-stone-500 font-semibold uppercase block mb-1">
                          Total
                        </label>
                        <span className="font-bold text-stone-900 block py-1.5">
                          {currencySymbol}{analyzed.total}
                        </span>
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* AI Price Guard Banner for this row */}
                    {analyzed.isPriceHike && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
                        <TrendingUp className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                        <span>
                          <strong>AI Price Guard:</strong> Rate increased by {currencySymbol}{analyzed.priceHikeAbsolute} ({analyzed.priceHikePercent}%) from last rate of {currencySymbol}{analyzed.previousRate}.
                        </span>
                      </div>
                    )}

                    {/* Purchase Protection Warning if above target */}
                    {analyzed.isAboveTarget && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                        <span>
                          <strong>Purchase Protection:</strong> Current stock ({analyzed.currentStock} {analyzed.unit}) is already above maximum target threshold. Recommended purchase is 0.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bill Net Calculation */}
            <div className="p-4 bg-stone-50 border-t border-stone-200 flex flex-col items-end gap-1 text-xs">
              <div className="flex justify-between w-48 text-stone-600">
                <span>Subtotal:</span>
                <span>{currencySymbol}{totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-48 text-stone-600">
                <span>Tax Amount:</span>
                <span>{currencySymbol}{taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between w-48 text-stone-900 font-bold text-sm pt-1 border-t border-stone-200">
                <span>Net Payable:</span>
                <span>{currencySymbol}{netAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Purchase Protection Override Checkbox (Mandatory if above target) */}
          {hasAboveTargetItems && (
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50/70 space-y-3">
              <div className="flex items-start gap-2.5">
                <input
                  id="override-checkbox"
                  type="checkbox"
                  checked={isOverride}
                  onChange={(e) => setIsOverride(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="override-checkbox" className="text-xs font-bold text-amber-900">
                  Override Purchase Safeguard Warning
                </label>
              </div>
              <p className="text-[11px] text-amber-800">
                You are purchasing stock that exceeds the target buffer. To prevent blocked cash, enter a valid operational reason:
              </p>
              {isOverride && (
                <input
                  type="text"
                  required={isOverride}
                  placeholder="e.g. Festival banquet bulk booking / Vendor giving special rate discount"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-amber-300 rounded-lg bg-white text-stone-900 focus:outline-none"
                />
              )}
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              id="confirm-inward-btn"
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Updating Stock...' : 'Confirm & Inward Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
