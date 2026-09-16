import React, { useEffect, useState } from 'react';
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  Building2,
  Boxes,
  Info,
  ShoppingCart,
  CheckCircle2,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Vendor, Issue } from '../types';
import { calculateAverageDailyConsumption, calculate15DayPurchaseRequirement } from '../services/calculations';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Badge } from '../components/common/Badge';

export interface PurchasePlanItem {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  currentStock: number;
  averageDailyConsumption: number;
  estimatedRequirement15Days: number;
  bufferStockNeeded: number;
  recommendedPurchaseQty: number;
  estimatedRate: number;
  estimatedTotalCost: number;
  primaryVendorId?: string;
  primaryVendorName?: string;
  hasConsumptionData: boolean;
  reason: string;
}

export const FifteenDayPlannerView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
      setLoading(false);
    });

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
    });

    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (snap) => {
      setIssues(snap.docs.map((d) => d.data() as Issue));
    });

    return () => {
      unsubItems();
      unsubVendors();
      unsubIssues();
    };
  }, [activeRestaurantId]);

  // Generate 15-day requirement for all items
  const planItems: PurchasePlanItem[] = items.map((item) => {
    const { avgDailyQty } = calculateAverageDailyConsumption(issues, item.id, 14);
    const { recommendedQty, estimatedAmount, reason } = calculate15DayPurchaseRequirement(item, avgDailyQty);
    const estimated15Days = Number((avgDailyQty * 15).toFixed(2));
    const rate = item.averageStockRate || item.lastPurchaseRate || 0;

    return {
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      unit: item.unit,
      currentStock: item.currentStock,
      averageDailyConsumption: avgDailyQty,
      estimatedRequirement15Days: estimated15Days,
      bufferStockNeeded: item.minimumStock || 0,
      recommendedPurchaseQty: recommendedQty,
      estimatedRate: rate,
      estimatedTotalCost: estimatedAmount,
      primaryVendorId: item.primaryVendorId,
      primaryVendorName: item.primaryVendorName,
      hasConsumptionData: avgDailyQty > 0,
      reason,
    };
  });

  const filteredItems = planItems.filter((p) => {
    if (selectedVendorFilter === 'ALL') return true;
    return p.primaryVendorId === selectedVendorFilter;
  });

  // Group by Vendor for supplier purchase order generation
  const vendorGroups: { [vendorId: string]: { vendorName: string; items: PurchasePlanItem[]; totalEst: number } } = {};
  filteredItems.forEach((p) => {
    const vId = p.primaryVendorId || 'UNASSIGNED';
    const vName = p.primaryVendorName || 'Unassigned Supplier';
    if (!vendorGroups[vId]) {
      vendorGroups[vId] = { vendorName: vName, items: [], totalEst: 0 };
    }
    vendorGroups[vId].items.push(p);
    vendorGroups[vId].totalEst += p.estimatedTotalCost;
  });

  const totalRecommendedBudget = filteredItems.reduce((sum, p) => sum + p.estimatedTotalCost, 0);

  const handleExportCsv = () => {
    const headers = [
      'Item Name',
      'Category',
      'Current Stock',
      'Daily Consumption',
      '15-Day Need',
      'Buffer / Min Stock',
      'Reorder Qty',
      'Est. Rate',
      'Est. Cost',
      'Supplier',
    ];
    const rows = filteredItems.map((p) => [
      p.itemName,
      p.category,
      p.currentStock,
      p.averageDailyConsumption,
      p.estimatedRequirement15Days,
      p.bufferStockNeeded,
      p.recommendedPurchaseQty,
      p.estimatedRate,
      p.estimatedTotalCost,
      p.primaryVendorName,
    ]);
    exportToCsv(`15_day_purchase_plan_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Item Name', 'In Stock', 'Daily Burn', '15-Day Need', 'Order Qty', 'Est. Total', 'Supplier'];
    const rows = filteredItems.map((p) => [
      p.itemName,
      `${p.currentStock} ${p.unit}`,
      `${p.averageDailyConsumption} ${p.unit}`,
      `${p.estimatedRequirement15Days} ${p.unit}`,
      `${p.recommendedPurchaseQty} ${p.unit}`,
      `${currencySymbol}${p.estimatedTotalCost}`,
      p.primaryVendorName,
    ]);
    exportToPdf('15-Day Intelligent Purchase Plan', activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">15-Day Intelligent Purchase Planner</h1>
            <Badge variant="neutral" size="sm">
              Consumption Math Engine
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Calculates exact 15-day inventory requirements based on 14-day weighted kitchen issues, lead time, and minimum buffer levels.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Filter and Summary Strip */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label className="text-xs text-stone-500 font-semibold uppercase">Filter Supplier:</label>
          <select
            value={selectedVendorFilter}
            onChange={(e) => setSelectedVendorFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white text-stone-700 focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">All Suppliers ({vendors.length})</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="text-stone-500">
            Items Requiring Reorder:{' '}
            <strong className="text-amber-700 font-bold">
              {filteredItems.filter((i) => i.recommendedPurchaseQty > 0).length}
            </strong>
          </span>
          <span className="text-stone-500">
            Total 15-Day Estimated Budget:{' '}
            <strong className="text-stone-900 font-black text-sm">
              {currencySymbol}{totalRecommendedBudget.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </strong>
          </span>
        </div>
      </div>

      {/* Supplier-Grouped Tables */}
      <div className="space-y-6">
        {loading ? (
          <div className="text-center py-12 text-stone-400 text-xs">Loading consumption projections...</div>
        ) : Object.keys(vendorGroups).length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center text-stone-400">
            No items found. Add items to store inventory to generate 15-day purchase projections.
          </div>
        ) : (
          Object.entries(vendorGroups).map(([vId, group]) => (
            <div key={vId} className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
              <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-stone-600" />
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    {group.vendorName}
                  </h3>
                  <span className="text-[11px] text-stone-500 font-normal">
                    ({group.items.length} mapped items)
                  </span>
                </div>
                <div className="text-xs font-bold text-stone-900">
                  Estimated PO Total: {currencySymbol}{group.totalEst.toFixed(2)}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-stone-600">
                  <thead className="text-[10px] font-bold text-stone-500 uppercase tracking-wider border-b border-stone-100">
                    <tr>
                      <th className="py-2.5 px-4">Item Name</th>
                      <th className="py-2.5 px-4 text-right">In Store</th>
                      <th className="py-2.5 px-4 text-right">Daily Consumption</th>
                      <th className="py-2.5 px-4 text-right">15-Day Need</th>
                      <th className="py-2.5 px-4 text-right">Safety Buffer</th>
                      <th className="py-2.5 px-4 text-right">Recommended Qty</th>
                      <th className="py-2.5 px-4 text-right">Unit Rate</th>
                      <th className="py-2.5 px-4 text-right">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {group.items.map((p) => (
                      <tr key={p.itemId} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-2.5 px-4 font-semibold text-stone-900">{p.itemName}</td>
                        <td className="py-2.5 px-4 text-right text-stone-700">
                          {p.currentStock} {p.unit}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[11px] text-stone-600">
                          {p.hasConsumptionData
                            ? `${p.averageDailyConsumption} ${p.unit}/day`
                            : 'Insufficient historical data'}
                        </td>
                        <td className="py-2.5 px-4 text-right text-stone-700">
                          {p.hasConsumptionData ? `${p.estimatedRequirement15Days} ${p.unit}` : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right text-stone-500">
                          {p.bufferStockNeeded} {p.unit}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-amber-700 text-sm">
                          {p.recommendedPurchaseQty > 0 ? (
                            <span>
                              {p.recommendedPurchaseQty} {p.unit}
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-semibold text-xs">Adequate Stock</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-stone-600">
                          {currencySymbol}{p.estimatedRate.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-stone-900">
                          {currencySymbol}{p.estimatedTotalCost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
