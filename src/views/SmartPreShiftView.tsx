import React, { useEffect, useState } from 'react';
import {
  Clock,
  Sparkles,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Calendar,
  Layers,
  Check,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Department, Issue, EmergencyIssue } from '../types';
import { calculateAverageDailyConsumption } from '../services/calculations';
import { executeDepartmentIssueTransaction } from '../services/restaurantService';
import { Badge } from '../components/common/Badge';

export const SmartPreShiftView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedShift, setSelectedShift] = useState<'MORNING' | 'EVENING'>('MORNING');
  const [batchIssuing, setBatchIssuing] = useState(false);
  const [batchSuccess, setBatchSuccess] = useState(false);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      const list = snap.docs.map((d) => d.data() as Department);
      setDepartments(list);
      if (list.length > 0 && !selectedDeptId) {
        setSelectedDeptId(list[0].id);
      }
    });

    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (snap) => {
      setIssues(snap.docs.map((d) => d.data() as Issue));
    });

    return () => {
      unsubItems();
      unsubDepts();
      unsubIssues();
    };
  }, [activeRestaurantId]);

  const activeDept = departments.find((d) => d.id === selectedDeptId);

  // Department Items recommendation based on actual consumption
  const deptItems = items.filter((i) => !selectedDeptId || i.departmentId === selectedDeptId || !i.departmentId);

  const recommendations = deptItems.map((item) => {
    const { avgDailyQty, hasData, totalConsumed } = calculateAverageDailyConsumption(issues, item.id, 14);

    if (!hasData || avgDailyQty <= 0) {
      return {
        item,
        hasData: false,
        recommendedShiftQty: 0,
        availableStock: item.currentStock,
        statusLabel: 'Insufficient historical data',
      };
    }

    // Shift allocation: Morning shift gets 60% of daily consumption, Evening gets 40%
    const shiftMultiplier = selectedShift === 'MORNING' ? 0.6 : 0.4;
    const recommendedQty = Number(Math.max(1, Math.round(avgDailyQty * shiftMultiplier * 10) / 10).toFixed(1));

    return {
      item,
      hasData: true,
      recommendedShiftQty: recommendedQty,
      availableStock: item.currentStock,
      statusLabel: `Calculated from 14-day history (${totalConsumed} ${item.unit} total)`,
    };
  });

  const validItemsToIssue = recommendations.filter((r) => r.hasData && r.recommendedShiftQty > 0 && r.availableStock >= r.recommendedShiftQty);

  const handleBatchIssueAll = async () => {
    if (!activeRestaurantId || validItemsToIssue.length === 0) return;

    try {
      setBatchIssuing(true);
      setBatchSuccess(false);

      for (const rec of validItemsToIssue) {
        await executeDepartmentIssueTransaction(activeRestaurantId, {
          departmentId: selectedDeptId,
          departmentName: activeDept?.name || 'Kitchen',
          itemId: rec.item.id,
          itemName: rec.item.name,
          unit: rec.item.unit,
          quantity: rec.recommendedShiftQty,
          staffUid: user?.uid || 'staff',
          staffName: `${activeDept?.name || 'Kitchen'} Shift Staff`,
          issuedByUid: user?.uid || 'storekeeper',
          issuedByName: userProfile?.name || 'Storekeeper',
          shift: selectedShift,
        });
      }

      setBatchSuccess(true);
      setTimeout(() => setBatchSuccess(false), 3000);
    } catch (e) {
      console.error('Batch issue error:', e);
    } finally {
      setBatchIssuing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Smart Pre-Shift Stock Issue</h1>
            <Badge variant="info" size="sm">
              Consumption AI Engine
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Data-driven shift opening recommendations derived from actual 14-day kitchen consumption records.
          </p>
        </div>

        {validItemsToIssue.length > 0 && (
          <button
            id="batch-issue-all-btn"
            onClick={handleBatchIssueAll}
            disabled={batchIssuing}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50"
          >
            {batchSuccess ? (
              <>
                <Check className="w-4 h-4" /> All Items Dispatched!
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" /> Dispatch Shift Stock ({validItemsToIssue.length} Items)
              </>
            )}
          </button>
        )}
      </div>

      {/* Department & Shift Selector */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col sm:flex-row items-center gap-4">
        <div className="w-full sm:w-64">
          <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
            Kitchen Department
          </label>
          <select
            id="smart-preshift-dept-select"
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white font-semibold text-stone-800 focus:outline-none focus:border-amber-500"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full sm:w-56">
          <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
            Service Shift
          </label>
          <div className="flex rounded-lg bg-stone-100 p-0.5 border border-stone-200">
            <button
              onClick={() => setSelectedShift('MORNING')}
              className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors ${
                selectedShift === 'MORNING'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Morning (Prep)
            </button>
            <button
              onClick={() => setSelectedShift('EVENING')}
              className={`flex-1 py-1 text-xs font-semibold rounded-md transition-colors ${
                selectedShift === 'EVENING'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Evening (Dinner)
            </button>
          </div>
        </div>
      </div>

      {/* Recommendations Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Item Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">In Store Stock</th>
                <th className="py-3 px-4 text-right">Recommended Issue</th>
                <th className="py-3 px-4">Historical Basis</th>
                <th className="py-3 px-4">Readiness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {recommendations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-400">
                    No items configured for this department.
                  </td>
                </tr>
              ) : (
                recommendations.map((rec) => (
                  <tr key={rec.item.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-stone-900">{rec.item.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-medium">
                        {rec.item.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-stone-700">
                      {rec.availableStock} {rec.item.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-amber-700 text-sm">
                      {rec.hasData ? `${rec.recommendedShiftQty} ${rec.item.unit}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                      {rec.statusLabel}
                    </td>
                    <td className="py-3 px-4">
                      {!rec.hasData ? (
                        <Badge variant="neutral" size="sm">
                          No Data
                        </Badge>
                      ) : rec.availableStock < rec.recommendedShiftQty ? (
                        <Badge variant="danger" size="sm">
                          Low Store Stock
                        </Badge>
                      ) : (
                        <Badge variant="success" size="sm">
                          Ready to Issue
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
