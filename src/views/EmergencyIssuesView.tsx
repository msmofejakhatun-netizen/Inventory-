import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Plus,
  AlertOctagon,
  Clock,
  User,
  CheckCircle,
  TrendingUp,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { EmergencyIssue, Item, Department, RestaurantUser } from '../types';
import { executeEmergencyIssueTransaction } from '../services/restaurantService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const EmergencyIssuesView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [emergencies, setEmergencies] = useState<EmergencyIssue[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  // New Emergency Requisition Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<EmergencyIssue['reason']>('Unexpected rush');
  const [customReason, setCustomReason] = useState('');
  const [staffName, setStaffName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubEmerg = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'emergencyIssues'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setEmergencies(snap.docs.map((d) => d.data() as EmergencyIssue));
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
      unsubEmerg();
      unsubItems();
      unsubDepts();
    };
  }, [activeRestaurantId]);

  // Repeated emergency alert check for the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysIso = sevenDaysAgo.toISOString();

  const deptCountsLast7Days: { [deptName: string]: number } = {};
  emergencies
    .filter((e) => e.createdAt >= sevenDaysIso)
    .forEach((e) => {
      deptCountsLast7Days[e.departmentName] = (deptCountsLast7Days[e.departmentName] || 0) + 1;
    });

  const repeatedAlerts = Object.entries(deptCountsLast7Days).filter(([_, count]) => count >= 3);

  const openEmergencyModal = () => {
    setSelectedDeptId(departments[0]?.id || '');
    setSelectedItemId(items[0]?.id || '');
    setQuantity(1);
    setReason('Unexpected rush');
    setCustomReason('');
    setStaffName(userProfile?.name || 'Chef');
    setFormError(null);
    setIsModalOpen(true);
  };

  const selectedItemObj = items.find((i) => i.id === selectedItemId);
  const availableStock = selectedItemObj?.currentStock || 0;

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
    if (quantity > availableStock) {
      setFormError(`Only ${availableStock} ${selectedItemObj?.unit} available in store.`);
      return;
    }
    if (!staffName.trim()) {
      setFormError('Please enter staff name.');
      return;
    }

    const deptObj = departments.find((d) => d.id === selectedDeptId);

    try {
      setSubmitting(true);
      await executeEmergencyIssueTransaction(activeRestaurantId, {
        departmentId: selectedDeptId,
        departmentName: deptObj?.name || 'Kitchen',
        itemId: selectedItemId,
        itemName: selectedItemObj?.name || 'Item',
        unit: selectedItemObj?.unit || 'Unit',
        quantity,
        reason,
        customReason,
        staffUid: user?.uid || 'staff',
        staffName: staffName.trim(),
      });

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Emergency requisition failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ['Date', 'Department', 'Item', 'Quantity', 'Reason', 'Custom Details', 'Staff', 'Cost Value'];
    const rows = emergencies.map((e) => [
      new Date(e.createdAt).toLocaleString(),
      e.departmentName,
      e.itemName,
      `${e.quantity} ${e.unit}`,
      e.reason,
      e.customReason || '',
      e.staffName,
      e.value,
    ]);
    exportToCsv(`emergency_issues_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Emergency Mid-Service Issues
            </h1>
            <Badge variant="warning" size="sm">
              Live Requisitions
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Log urgent mid-service stock pullouts. Tracks unplanned demands and repeated pattern bottlenecks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="emergency-issue-btn"
            onClick={openEmergencyModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <AlertTriangle className="w-4 h-4" /> Record Emergency Requisition
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Repeated Emergency Alerts Banner */}
      {repeatedAlerts.length > 0 && (
        <div className="space-y-2">
          {repeatedAlerts.map(([deptName, count]) => (
            <div
              key={deptName}
              className="p-4 rounded-xl border border-amber-300 bg-amber-50/80 flex items-start gap-3 shadow-2xs"
            >
              <AlertOctagon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-amber-900">
                  Repeated Emergency Requisition Alert: {deptName}
                </h4>
                <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                  <strong>{deptName}</strong> has requested emergency stock {count} times in the last 7 days. Consider increasing pre-shift issue quantities to prevent service bottlenecks and kitchen delays.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Requisitions Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-4 text-right">Quantity</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-4">Requested By</th>
                <th className="py-3 px-4 text-right">Cost Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-stone-400">
                    Loading emergency logs...
                  </td>
                </tr>
              ) : emergencies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-stone-400">
                    <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-1.5 opacity-50" />
                    No emergency requisitions recorded. Kitchen is well planned!
                  </td>
                </tr>
              ) : (
                emergencies.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                      {new Date(e.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 font-semibold text-stone-900">{e.departmentName}</td>
                    <td className="py-3 px-4 font-medium text-stone-800">{e.itemName}</td>
                    <td className="py-3 px-4 text-right font-bold text-rose-700">
                      {e.quantity} <span className="text-[10px] text-stone-500">{e.unit}</span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="warning" size="sm">
                        {e.reason}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-stone-500 text-[11px] max-w-xs truncate">
                      {e.customReason || '-'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-stone-700">{e.staffName}</td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {currencySymbol}{e.value.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Emergency Requisition Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Record Emergency Stock Requisition"
        subtitle="Immediate stock draw during peak service or preparation rush"
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
                Item *
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
                Emergency Quantity ({selectedItemObj?.unit || 'Unit'}) *
              </label>
              <input
                type="number"
                min={0.01}
                max={availableStock}
                step="any"
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-bold text-stone-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Primary Reason *
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="Unexpected rush">Unexpected rush</option>
                <option value="Stock finished">Stock finished mid-shift</option>
                <option value="Wrong estimation">Wrong morning estimation</option>
                <option value="Wastage">Kitchen spillage / Wastage</option>
                <option value="Preparation increased">Bulk preparation increased</option>
                <option value="Other">Other reason</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Custom Explanation / Notes
            </label>
            <input
              type="text"
              placeholder="e.g. Table 14 ordered 8 portions of special gravy"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Staff / Chef Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Chef Sanjay"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
            />
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
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Recording...' : 'Dispatch Emergency Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
