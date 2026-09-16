import React, { useEffect, useState } from 'react';
import {
  Trash2,
  Plus,
  Search,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  PieChart,
  TrendingDown,
  User,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Wastage, Item, Department } from '../types';
import { executeWastageTransaction } from '../services/restaurantService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const WastageView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [wastages, setWastages] = useState<Wastage[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  // New Wastage Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<Wastage['reason']>('Preparation Spoilage');
  const [staffName, setStaffName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterReason, setFilterReason] = useState('ALL');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubWastage = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'wastage'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setWastages(snap.docs.map((d) => d.data() as Wastage));
        setLoading(false);
      }
    );

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      setDepartments(snap.docs.map((d) => d.data() as Department));
    });

    return () => {
      unsubWastage();
      unsubItems();
      unsubDepts();
    };
  }, [activeRestaurantId]);

  const openWastageModal = () => {
    setSelectedDeptId(departments[0]?.id || '');
    setSelectedItemId(items[0]?.id || '');
    setQuantity(1);
    setReason('Preparation Spoilage');
    setStaffName(userProfile?.name || 'Chef');
    setNotes('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const selectedItemObj = items.find((i) => i.id === selectedItemId);
  const unitRate = selectedItemObj?.averageStockRate || selectedItemObj?.lastPurchaseRate || 0;
  const estimatedCost = Number((quantity * unitRate).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!activeRestaurantId) return;
    if (!selectedItemId) {
      setFormError('Please select an item.');
      return;
    }
    if (quantity <= 0) {
      setFormError('Quantity must be greater than 0.');
      return;
    }
    if (quantity > (selectedItemObj?.currentStock || 0)) {
      setFormError(`Only ${selectedItemObj?.currentStock} ${selectedItemObj?.unit} currently in stock.`);
      return;
    }

    const deptObj = departments.find((d) => d.id === selectedDeptId);

    try {
      setSubmitting(true);
      await executeWastageTransaction(activeRestaurantId, {
        departmentId: selectedDeptId,
        departmentName: deptObj?.name || 'Kitchen',
        itemId: selectedItemId,
        itemName: selectedItemObj?.name || 'Item',
        unit: selectedItemObj?.unit || 'Unit',
        quantity,
        reason,
        notes,
        staffUid: user?.uid || 'staff',
        staffName: staffName.trim(),
      });

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to record wastage.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredWastages = wastages.filter((w) => {
    const matchSearch =
      w.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.departmentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.staffName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchReason = filterReason === 'ALL' || w.reason === filterReason;
    return matchSearch && matchReason;
  });

  const totalWastageLoss = filteredWastages.reduce((sum, w) => sum + (Number(w.value) || 0), 0);

  const handleExportCsv = () => {
    const headers = ['Date', 'Department', 'Item', 'Quantity', 'Unit', 'Rate', 'Financial Loss', 'Reason', 'Staff'];
    const rows = filteredWastages.map((w) => [
      new Date(w.createdAt).toLocaleString(),
      w.departmentName,
      w.itemName,
      w.quantity,
      w.unit,
      w.rate,
      w.value,
      w.reason,
      w.staffName,
    ]);
    exportToCsv(`wastage_records_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Date', 'Dept', 'Item', 'Qty', 'Loss', 'Reason', 'Staff'];
    const rows = filteredWastages.map((w) => [
      new Date(w.createdAt).toLocaleDateString(),
      w.departmentName,
      w.itemName,
      `${w.quantity} ${w.unit}`,
      `${currencySymbol}${w.value}`,
      w.reason,
      w.staffName,
    ]);
    exportToPdf('Kitchen Wastage & Loss Audit', activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Kitchen Wastage & Loss Register</h1>
            <Badge variant="danger" size="sm">
              Financial Scrap Audit
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Track spoilage, expired stock, kitchen burning, and dish remakes with root-cause categorization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="record-wastage-btn"
            onClick={openWastageModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Log Wastage
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
            <FileSpreadsheet className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {/* Filter and Loss KPI strip */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="wastage-search-input"
            type="text"
            placeholder="Search by item, department, or staff member..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        <select
          value={filterReason}
          onChange={(e) => setFilterReason(e.target.value)}
          className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white text-stone-700 focus:outline-none focus:border-amber-500 w-full md:w-auto"
        >
          <option value="ALL">All Reasons</option>
          <option value="Expiry">Expiry</option>
          <option value="Burning / Overcooked">Burning / Overcooked</option>
          <option value="Preparation Spoilage">Preparation Spoilage</option>
          <option value="Drop / Breakage">Drop / Breakage</option>
          <option value="Quality Rejection">Quality Rejection</option>
          <option value="Other">Other</option>
        </select>

        <div className="text-xs text-stone-600 font-medium whitespace-nowrap">
          Total Wastage Loss:{' '}
          <span className="font-bold text-rose-700 text-sm">
            {currencySymbol}{totalWastageLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Wastage Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Item Wasted</th>
                <th className="py-3 px-4 text-right">Quantity</th>
                <th className="py-3 px-4 text-right">Unit Rate</th>
                <th className="py-3 px-4 text-right">Financial Loss</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Logged By / Staff</th>
                <th className="py-3 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-400">
                    Loading wastage audit...
                  </td>
                </tr>
              ) : filteredWastages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-stone-400">
                    No wastage incidents recorded. Great operational control!
                  </td>
                </tr>
              ) : (
                filteredWastages.map((w) => (
                  <tr key={w.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                      {new Date(w.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 font-semibold text-stone-800">{w.departmentName}</td>
                    <td className="py-3 px-4 font-medium text-stone-900">{w.itemName}</td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {w.quantity} <span className="text-[10px] text-stone-500 font-normal">{w.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-stone-600">
                      {currencySymbol}{w.rate.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-black text-rose-700">
                      {currencySymbol}{w.value.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="danger" size="sm">
                        {w.reason}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-semibold text-stone-700">{w.staffName}</td>
                    <td className="py-3 px-4 text-stone-500 text-[11px] max-w-xs truncate">
                      {w.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Wastage Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Record Kitchen Wastage Incident"
        subtitle="Immediately writes off inventory at weighted average rate with root cause classification"
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Department *
              </label>
              <select
                required
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Item Wasted *
              </label>
              <select
                required
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white font-medium"
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} (Stock: {i.currentStock} {i.unit})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Wastage Quantity ({selectedItemObj?.unit || 'Unit'}) *
              </label>
              <input
                type="number"
                min={0.01}
                max={selectedItemObj?.currentStock || 0}
                step="any"
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-bold text-stone-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Reason *
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="Preparation Spoilage">Preparation Spoilage</option>
                <option value="Burning / Overcooked">Burning / Overcooked</option>
                <option value="Expiry">Expired Date</option>
                <option value="Drop / Breakage">Floor Drop / Breakage</option>
                <option value="Quality Rejection">Quality Rejection</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex justify-between items-center text-xs">
            <span className="text-rose-900 font-medium">Estimated Financial Write-off:</span>
            <span className="text-sm font-black text-rose-950">
              {currencySymbol}{estimatedCost.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Staff / Chef Name
              </label>
              <input
                type="text"
                placeholder="e.g. Chef Sanjay"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Notes / Cause
              </label>
              <input
                type="text"
                placeholder="e.g. Milk soured due to refrigerator power fluctuation"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
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
              id="confirm-wastage-btn"
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Writing Off...' : 'Confirm Wastage Loss'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
