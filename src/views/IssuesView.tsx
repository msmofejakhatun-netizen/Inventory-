import React, { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Plus,
  Search,
  Filter,
  User,
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Issue, Item, Department, RestaurantUser } from '../types';
import { executeDepartmentIssueTransaction } from '../services/restaurantService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const IssuesView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffMembers, setStaffMembers] = useState<RestaurantUser[]>([]);
  const [loading, setLoading] = useState(true);

  // New Issue Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [staffName, setStaffName] = useState('');
  const [shift, setShift] = useState<Issue['shift']>('MORNING');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Staff Accountability Filters
  const [searchStaff, setSearchStaff] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('ALL');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubIssues = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'issues'), orderBy('createdAt', 'desc'), limit(150)),
      (snap) => {
        setIssues(snap.docs.map((d) => d.data() as Issue));
        setLoading(false);
      }
    );

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      const list = snap.docs.map((d) => d.data() as Department);
      setDepartments(list);
    });

    const unsubUsers = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'users'), (snap) => {
      setStaffMembers(snap.docs.map((d) => d.data() as RestaurantUser));
    });

    return () => {
      unsubIssues();
      unsubItems();
      unsubDepts();
      unsubUsers();
    };
  }, [activeRestaurantId]);

  const openIssueModal = () => {
    setSelectedDeptId(departments[0]?.id || '');
    setSelectedItemId(items[0]?.id || '');
    setQuantity(1);
    setStaffName(staffMembers[0]?.name || userProfile?.name || 'Chef');
    setShift('MORNING');
    setFormError(null);
    setIsModalOpen(true);
  };

  const selectedItemObj = items.find((i) => i.id === selectedItemId);
  const currentAvailableStock = selectedItemObj?.currentStock || 0;
  const unitRate = selectedItemObj?.averageStockRate || selectedItemObj?.lastPurchaseRate || 0;
  const totalIssueValue = Number((quantity * unitRate).toFixed(2));

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!activeRestaurantId) return;
    if (!selectedItemId) {
      setFormError('Please select an item to issue.');
      return;
    }
    if (quantity <= 0) {
      setFormError('Quantity must be greater than 0.');
      return;
    }
    if (quantity > currentAvailableStock) {
      setFormError(
        `Insufficient stock! Only ${currentAvailableStock} ${selectedItemObj?.unit} available in store.`
      );
      return;
    }
    if (!staffName.trim()) {
      setFormError('Please enter the name of the staff member receiving the stock.');
      return;
    }

    const deptObj = departments.find((d) => d.id === selectedDeptId);

    try {
      setSubmitting(true);
      await executeDepartmentIssueTransaction(activeRestaurantId, {
        departmentId: selectedDeptId,
        departmentName: deptObj?.name || 'Kitchen',
        itemId: selectedItemId,
        itemName: selectedItemObj?.name || 'Item',
        unit: selectedItemObj?.unit || 'Unit',
        quantity,
        staffUid: user?.uid || 'staff',
        staffName: staffName.trim(),
        issuedByUid: user?.uid || 'storekeeper',
        issuedByName: userProfile?.name || 'Storekeeper',
        shift,
      });

      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Issue failed:', err);
      setFormError(err?.message || 'Failed to issue stock.');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered list by Staff Accountability
  const filteredIssues = issues.filter((iss) => {
    const matchStaff =
      iss.staffName.toLowerCase().includes(searchStaff.toLowerCase()) ||
      iss.itemName.toLowerCase().includes(searchStaff.toLowerCase());
    const matchDept = filterDeptId === 'ALL' || iss.departmentId === filterDeptId;
    return matchStaff && matchDept;
  });

  const totalFilteredValue = filteredIssues.reduce((sum, i) => sum + (Number(i.value) || 0), 0);

  const handleExportCsv = () => {
    const headers = ['Date', 'Department', 'Item', 'Quantity', 'Unit', 'Rate', 'Issue Value', 'Received By (Staff)', 'Shift'];
    const rows = filteredIssues.map((i) => [
      new Date(i.createdAt).toLocaleString(),
      i.departmentName,
      i.itemName,
      i.quantity,
      i.unit,
      i.rate,
      i.value,
      i.staffName,
      i.shift,
    ]);
    exportToCsv(`stock_issues_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Date', 'Dept', 'Item', 'Qty', 'Value', 'Staff'];
    const rows = filteredIssues.map((i) => [
      new Date(i.createdAt).toLocaleDateString(),
      i.departmentName,
      i.itemName,
      `${i.quantity} ${i.unit}`,
      `${currencySymbol}${i.value}`,
      i.staffName,
    ]);
    exportToPdf('Department Stock Issue Ledger', activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Kitchen Department Stock Issues
            </h1>
            <Badge variant="neutral" size="sm">
              Staff Accountability
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Requisition dispatch register. Deducts stock at current weighted average cost with complete staff traceability.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="issue-stock-btn"
            onClick={openIssueModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Issue Stock to Kitchen
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

      {/* Staff Accountability Filter Search */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="staff-search-input"
            type="text"
            placeholder="Search 'What did Rahul take?' or search by item / chef..."
            value={searchStaff}
            onChange={(e) => setSearchStaff(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        <select
          value={filterDeptId}
          onChange={(e) => setFilterDeptId(e.target.value)}
          className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-amber-500 text-stone-700 w-full md:w-auto"
        >
          <option value="ALL">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <div className="text-xs text-stone-600 font-medium whitespace-nowrap">
          Total Value: <span className="font-bold text-stone-900">{currencySymbol}{totalFilteredValue.toFixed(2)}</span>
        </div>
      </div>

      {/* Issues Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Item Issued</th>
                <th className="py-3 px-4 text-right">Quantity</th>
                <th className="py-3 px-4 text-right">Unit Cost</th>
                <th className="py-3 px-4 text-right">Total Value</th>
                <th className="py-3 px-4">Received By (Staff)</th>
                <th className="py-3 px-4">Shift</th>
                <th className="py-3 px-4">Storekeeper</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-400">
                    Loading issue ledger...
                  </td>
                </tr>
              ) : filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-stone-400">
                    No stock issues found matching the query.
                  </td>
                </tr>
              ) : (
                filteredIssues.map((iss) => (
                  <tr key={iss.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                      {new Date(iss.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 font-semibold text-stone-800">{iss.departmentName}</td>
                    <td className="py-3 px-4 font-medium text-stone-900">{iss.itemName}</td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {iss.quantity} <span className="text-[10px] font-normal text-stone-500">{iss.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-right text-stone-600">
                      {currencySymbol}{iss.rate.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {currencySymbol}{iss.value.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-amber-800 bg-amber-50/40">
                      {iss.staffName}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="neutral" size="sm">
                        {iss.shift}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-stone-400 text-[11px]">{iss.issuedByName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Issue Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Issue Stock to Kitchen Department"
        subtitle="Deducts stock immediately and assigns full accountability to staff"
        maxWidth="lg"
      >
        <form onSubmit={handleIssueSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Kitchen Department *
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
                Shift
              </label>
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="MORNING">Morning Shift</option>
                <option value="EVENING">Evening Shift</option>
                <option value="NIGHT">Night Shift</option>
                <option value="GENERAL">General Store</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Select Item *
            </label>
            <select
              required
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white font-medium"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (In Store: {i.currentStock} {i.unit})
                </option>
              ))}
            </select>
          </div>

          {/* Live stock & value badge */}
          {selectedItemObj && (
            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-stone-500">Available Stock:</span>
                <span className="font-bold text-stone-900 ml-1.5">
                  {currentAvailableStock} {selectedItemObj.unit}
                </span>
              </div>
              <div>
                <span className="text-stone-500">Weighted Avg Cost:</span>
                <span className="font-bold text-stone-900 ml-1.5">
                  {currencySymbol}{unitRate} / {selectedItemObj.unit}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Issue Quantity ({selectedItemObj?.unit || 'Unit'}) *
              </label>
              <input
                type="number"
                min={0.01}
                max={currentAvailableStock}
                step="any"
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-bold text-stone-900 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Received By (Staff / Chef Name) *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Chef Rahul / Amit"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-200/80 flex justify-between items-center text-xs">
            <span className="text-amber-900 font-medium">Total Issue Value (Cost):</span>
            <span className="text-sm font-black text-amber-950">
              {currencySymbol}{totalIssueValue.toFixed(2)}
            </span>
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
              id="confirm-issue-submit-btn"
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Issuing...' : 'Confirm Stock Issue'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
