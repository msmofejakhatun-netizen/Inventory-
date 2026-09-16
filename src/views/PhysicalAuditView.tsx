import React, { useEffect, useState } from 'react';
import {
  ClipboardCheck,
  Search,
  CheckCircle,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Check,
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, StockCount } from '../types';
import { executeStockAdjustmentTransaction } from '../services/restaurantService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const PhysicalAuditView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [adjustments, setAdjustments] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);

  // Single Item Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [physicalCount, setPhysicalCount] = useState(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filter
  const [searchQuery, setSearchQuery] = useState('');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
      setLoading(false);
    });

    const unsubAdj = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'stockCounts'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setAdjustments(snap.docs.map((d) => d.data() as StockCount));
      }
    );

    return () => {
      unsubItems();
      unsubAdj();
    };
  }, [activeRestaurantId]);

  const openAdjustModal = (item: Item) => {
    setSelectedItem(item);
    setPhysicalCount(item.currentStock);
    setNotes('');
    setIsAdjustModalOpen(true);
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !selectedItem) return;

    try {
      setSubmitting(true);
      await executeStockAdjustmentTransaction(activeRestaurantId, {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        unit: selectedItem.unit,
        physicalStock: Number(physicalCount),
        reason: notes.trim() || 'Physical inventory audit and reconciliation',
        countedByUid: user?.uid || 'staff',
        countedByName: userProfile?.name || 'Auditor',
      });

      setIsAdjustModalOpen(false);
    } catch (err) {
      console.error('Adjustment failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredItems = items.filter((i) => {
    return (
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const handleExportCsv = () => {
    const headers = ['Date', 'Item Name', 'System Stock', 'Physical Count', 'Variance Qty', 'Variance Value', 'Auditor'];
    const rows = adjustments.map((a) => [
      new Date(a.createdAt).toLocaleString(),
      a.itemName,
      a.systemStock,
      a.physicalStock,
      a.varianceQuantity,
      a.varianceValue,
      a.countedByName,
    ]);
    exportToCsv(`stock_audits_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Physical Stock Audit & Closing Count</h1>
            <Badge variant="neutral" size="sm">
              Variance Reconciliation
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Reconcile physical floor counts against software stock ledger with automated variance write-offs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> CSV Export
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="audit-search-input"
            type="text"
            placeholder="Search items for physical count..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Current Floor Items Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="p-3 bg-stone-50 border-b border-stone-200">
          <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
            Inventory SKUs Ready for Count Check
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="text-[10px] font-bold text-stone-500 uppercase tracking-wider border-b border-stone-100 bg-stone-50/50">
              <tr>
                <th className="py-2.5 px-4">Item Name</th>
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-4 text-right">System Book Stock</th>
                <th className="py-2.5 px-4 text-right">Weighted Rate</th>
                <th className="py-2.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-stone-400">
                    Loading items...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-stone-400">
                    No items found.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-stone-900">{item.name}</td>
                    <td className="py-3 px-4 text-stone-500">{item.category}</td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {item.currentStock} {item.unit}
                    </td>
                    <td className="py-3 px-4 text-right text-stone-600">
                      {currencySymbol}{(item.averageStockRate || item.lastPurchaseRate || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openAdjustModal(item)}
                        className="px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-xs font-semibold"
                      >
                        Count & Reconcile
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Audits Table */}
      {adjustments.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
          <div className="p-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
              Recent Physical Audit Reconciliations
            </h3>
            <span className="text-[11px] text-stone-500">{adjustments.length} logged adjustments</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="text-[10px] font-bold text-stone-500 uppercase tracking-wider border-b border-stone-100">
                <tr>
                  <th className="py-2.5 px-4">Audit Time</th>
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-4 text-right">System</th>
                  <th className="py-2.5 px-4 text-right">Physical</th>
                  <th className="py-2.5 px-4 text-right">Variance Qty</th>
                  <th className="py-2.5 px-4 text-right">Variance Value</th>
                  <th className="py-2.5 px-4">Auditor</th>
                  <th className="py-2.5 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {adjustments.map((a) => (
                  <tr key={a.id} className="hover:bg-stone-50/60">
                    <td className="py-2.5 px-4 text-stone-500 text-[11px] font-mono">
                      {new Date(a.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-stone-900">{a.itemName}</td>
                    <td className="py-2.5 px-4 text-right">{a.systemStock}</td>
                    <td className="py-2.5 px-4 text-right font-bold text-stone-900">{a.physicalStock}</td>
                    <td className="py-2.5 px-4 text-right font-bold">
                      <span className={a.varianceQuantity < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                        {a.varianceQuantity > 0 ? `+${a.varianceQuantity}` : a.varianceQuantity}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold">
                      <span className={a.varianceValue < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                        {currencySymbol}{a.varianceValue.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-stone-600">{a.countedByName}</td>
                    <td className="py-2.5 px-4 text-stone-500 text-[11px]">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adjust Modal */}
      <Modal
        isOpen={isAdjustModalOpen}
        onClose={() => setIsAdjustModalOpen(false)}
        title={`Reconcile Physical Count: ${selectedItem?.name}`}
        subtitle="Immediately updates system stock to physical count and logs financial variance"
        maxWidth="md"
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4">
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex justify-between items-center text-xs">
            <div>
              <span className="text-stone-500">System Book Stock:</span>
              <span className="font-bold text-stone-900 ml-1.5">
                {selectedItem?.currentStock} {selectedItem?.unit}
              </span>
            </div>
            <div>
              <span className="text-stone-500">Rate:</span>
              <span className="font-bold text-stone-900 ml-1.5">
                {currencySymbol}{selectedItem?.averageStockRate || selectedItem?.lastPurchaseRate || 0}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Actual Physical Count on Floor ({selectedItem?.unit}) *
            </label>
            <input
              type="number"
              min={0}
              step="any"
              required
              value={physicalCount}
              onChange={(e) => setPhysicalCount(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-bold border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>

          {selectedItem && (
            <div className="p-3 rounded-lg border text-xs flex justify-between items-center bg-stone-50">
              <span className="font-semibold text-stone-700">Calculated Variance:</span>
              <span
                className={`font-bold text-sm ${
                  physicalCount - selectedItem.currentStock < 0 ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {physicalCount - selectedItem.currentStock > 0
                  ? `+${(physicalCount - selectedItem.currentStock).toFixed(2)}`
                  : (physicalCount - selectedItem.currentStock).toFixed(2)}{' '}
                {selectedItem.unit} (
                {currencySymbol}
                {(
                  (physicalCount - selectedItem.currentStock) *
                  (selectedItem.averageStockRate || selectedItem.lastPurchaseRate || 0)
                ).toFixed(2)}
                )
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Audit Notes / Reason for Discrepancy
            </label>
            <input
              type="text"
              placeholder="e.g. Unrecorded spillage during prep or over-portioning"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsAdjustModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Reconciling...' : 'Confirm Audit & Adjust'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
