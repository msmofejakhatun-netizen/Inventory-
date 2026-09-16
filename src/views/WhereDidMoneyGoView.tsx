import React, { useEffect, useState, useMemo } from 'react';
import {
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  Calendar,
  Layers,
  Building2,
  DollarSign,
  AlertTriangle,
  ArrowRight,
  Info,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Purchase, Issue, Wastage, Department } from '../types';
import { calculateWhereDidMyMoneyGo } from '../services/calculations';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Badge } from '../components/common/Badge';

export const WhereDidMoneyGoView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [wastages, setWastages] = useState<Wastage[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  // Time filter: '7_DAYS' | '30_DAYS' | 'THIS_MONTH' | 'ALL_TIME'
  const [period, setPeriod] = useState<'7_DAYS' | '30_DAYS' | 'THIS_MONTH' | 'ALL_TIME'>('30_DAYS');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
      setLoading(false);
    });

    const unsubPurchases = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'purchases'), orderBy('createdAt', 'desc')),
      (snap) => {
        setPurchases(snap.docs.map((d) => d.data() as Purchase));
      }
    );

    const unsubIssues = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'issues'), orderBy('createdAt', 'desc')),
      (snap) => {
        setIssues(snap.docs.map((d) => d.data() as Issue));
      }
    );

    const unsubWastage = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'wastage'), orderBy('createdAt', 'desc')),
      (snap) => {
        setWastages(snap.docs.map((d) => d.data() as Wastage));
      }
    );

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      setDepartments(snap.docs.map((d) => d.data() as Department));
    });

    return () => {
      unsubItems();
      unsubPurchases();
      unsubIssues();
      unsubWastage();
      unsubDepts();
    };
  }, [activeRestaurantId]);

  // Compute date cutoff based on selected period
  const cutoffDateIso = useMemo(() => {
    const now = new Date();
    if (period === '7_DAYS') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString();
    }
    if (period === '30_DAYS') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d.toISOString();
    }
    if (period === 'THIS_MONTH') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return d.toISOString();
    }
    return '1970-01-01T00:00:00.000Z';
  }, [period]);

  // Filtered operational records
  const filteredPurchases = useMemo(
    () => purchases.filter((p) => p.createdAt >= cutoffDateIso),
    [purchases, cutoffDateIso]
  );
  const filteredIssues = useMemo(
    () => issues.filter((i) => i.createdAt >= cutoffDateIso),
    [issues, cutoffDateIso]
  );
  const filteredWastages = useMemo(
    () => wastages.filter((w) => w.createdAt >= cutoffDateIso),
    [wastages, cutoffDateIso]
  );

  // Financial values
  const totalPurchasesValue = useMemo(
    () => filteredPurchases.reduce((sum, p) => sum + (Number(p.netAmount) || 0), 0),
    [filteredPurchases]
  );

  const closingStockValue = useMemo(
    () =>
      items.reduce(
        (sum, i) => sum + (Number(i.currentStock) || 0) * (Number(i.averageStockRate) || Number(i.lastPurchaseRate) || 0),
        0
      ),
    [items]
  );

  const totalWastageValue = useMemo(
    () => filteredWastages.reduce((sum, w) => sum + (Number(w.value) || 0), 0),
    [filteredWastages]
  );

  // Group issues by department
  const departmentIssuesMap = useMemo(() => {
    const map: { [deptName: string]: number } = {};
    filteredIssues.forEach((iss) => {
      const dName = iss.departmentName || 'General Kitchen';
      map[dName] = (map[dName] || 0) + (Number(iss.value) || 0);
    });
    return Object.entries(map).map(([departmentName, value]) => ({ departmentName, value }));
  }, [filteredIssues]);

  // Group consumption by Item Category
  const categoryIssuesMap = useMemo(() => {
    const map: { [category: string]: number } = {};
    filteredIssues.forEach((iss) => {
      const item = items.find((i) => i.id === iss.itemId);
      const cat = item?.category || 'General Store';
      map[cat] = (map[cat] || 0) + (Number(iss.value) || 0);
    });
    return Object.entries(map)
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredIssues, items]);

  // Initial opening stock estimate:
  // In inventory accounting: Opening Stock + Purchases - Closing Stock = Consumption
  // If opening stock wasn't snapshotted, derive opening stock from current + issues + wastage - purchases
  const derivedOpeningStockValue = useMemo(() => {
    const totalIssuesVal = filteredIssues.reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    const estOpening = closingStockValue + totalIssuesVal + totalWastageValue - totalPurchasesValue;
    return Math.max(0, estOpening);
  }, [closingStockValue, filteredIssues, totalWastageValue, totalPurchasesValue]);

  // Use core mathematical function
  const moneyAnalysis = useMemo(() => {
    return calculateWhereDidMyMoneyGo(
      derivedOpeningStockValue,
      totalPurchasesValue,
      closingStockValue,
      departmentIssuesMap,
      totalWastageValue
    );
  }, [derivedOpeningStockValue, totalPurchasesValue, closingStockValue, departmentIssuesMap, totalWastageValue]);

  const handleExportCsv = () => {
    const headers = ['Financial Dimension / Department', 'Amount', 'Share of Consumed Stock'];
    const rows: (string | number)[][] = [
      ['Opening Stock Value', moneyAnalysis.openingStockValue, '—'],
      ['Purchases Value (Inward)', moneyAnalysis.purchasesValue, '—'],
      ['Closing Stock Value (Floor)', moneyAnalysis.closingStockValue, '—'],
      ['Total Stock Consumed', moneyAnalysis.stockConsumed, '100%'],
      ['Wastage Loss', moneyAnalysis.wastageValue, `${moneyAnalysis.wastagePercent}%`],
    ];

    moneyAnalysis.departmentBreakdown.forEach((dept) => {
      rows.push([`Department: ${dept.name}`, dept.value, `${dept.percent}%`]);
    });

    exportToCsv(`where_did_my_money_go_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Financial Dimension / Station', 'Amount', 'Share %'];
    const rows: (string | number)[][] = [
      ['Opening Stock Value', `${currencySymbol}${moneyAnalysis.openingStockValue.toFixed(2)}`, '—'],
      ['Purchases Value (Inward)', `${currencySymbol}${moneyAnalysis.purchasesValue.toFixed(2)}`, '—'],
      ['Closing Stock Value', `${currencySymbol}${moneyAnalysis.closingStockValue.toFixed(2)}`, '—'],
      ['Total Stock Consumed', `${currencySymbol}${moneyAnalysis.stockConsumed.toFixed(2)}`, '100%'],
      ['Wastage Loss', `${currencySymbol}${moneyAnalysis.wastageValue.toFixed(2)}`, `${moneyAnalysis.wastagePercent}%`],
    ];

    moneyAnalysis.departmentBreakdown.forEach((dept) => {
      rows.push([`Dept: ${dept.name}`, `${currencySymbol}${dept.value.toFixed(2)}`, `${dept.percent}%`]);
    });

    exportToPdf(
      'Where Did My Money Go - Stock Consumption Audit',
      activeRestaurant?.name || 'Store',
      headers,
      rows
    );
  };

  const hasData = items.length > 0 || purchases.length > 0 || issues.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Where Did My Money Go?</h1>
            <Badge variant="info" size="sm">
              Financial Stock Reconciliation
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Reconcile procurement expenditure against kitchen station consumption and wastage losses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="flex items-center bg-stone-100 p-1 rounded-lg text-xs font-semibold text-stone-700">
            <button
              onClick={() => setPeriod('7_DAYS')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                period === '7_DAYS' ? 'bg-white shadow-2xs text-stone-900 font-bold' : 'hover:text-stone-900'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setPeriod('30_DAYS')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                period === '30_DAYS' ? 'bg-white shadow-2xs text-stone-900 font-bold' : 'hover:text-stone-900'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setPeriod('THIS_MONTH')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                period === 'THIS_MONTH' ? 'bg-white shadow-2xs text-stone-900 font-bold' : 'hover:text-stone-900'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setPeriod('ALL_TIME')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                period === 'ALL_TIME' ? 'bg-white shadow-2xs text-stone-900 font-bold' : 'hover:text-stone-900'
              }`}
            >
              All Time
            </button>
          </div>

          <button
            onClick={handleExportCsv}
            disabled={!hasData}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={handleExportPdf}
            disabled={!hasData}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {!hasData && !loading ? (
        <div className="bg-white rounded-xl border border-stone-200 p-12 text-center shadow-2xs">
          <PieChartIcon className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-stone-900 uppercase tracking-wider">No Financial Data Recorded Yet</h3>
          <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
            Once you log inward purchases and department dispatches, this report will automatically calculate where
            every dollar of raw inventory was consumed.
          </p>
        </div>
      ) : (
        <>
          {/* Core Formula Cards: Opening + Purchases - Closing = Consumed */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Opening Stock */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
                Opening Stock Value
              </span>
              <div className="text-2xl font-black text-stone-900 mt-1">
                {currencySymbol}
                {moneyAnalysis.openingStockValue.toLocaleString()}
              </div>
              <span className="text-[10px] text-stone-400 mt-1 block">Value at start of selected period</span>
            </div>

            {/* Purchases */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
                  + Purchases (Inward)
                </span>
                <Badge variant="neutral" size="sm">
                  {filteredPurchases.length} bills
                </Badge>
              </div>
              <div className="text-2xl font-black text-emerald-700 mt-1">
                {currencySymbol}
                {moneyAnalysis.purchasesValue.toLocaleString()}
              </div>
              <span className="text-[10px] text-stone-400 mt-1 block">Cash invested in procurement</span>
            </div>

            {/* Closing Stock */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
                - Closing Stock Value
              </span>
              <div className="text-2xl font-black text-stone-900 mt-1">
                {currencySymbol}
                {moneyAnalysis.closingStockValue.toLocaleString()}
              </div>
              <span className="text-[10px] text-stone-400 mt-1 block">Live inventory on store shelves</span>
            </div>

            {/* Consumed Stock Result */}
            <div className="bg-amber-500/10 rounded-xl border border-amber-300/40 p-4 shadow-2xs">
              <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
                = Total Stock Consumed
              </span>
              <div className="text-2xl font-black text-amber-900 mt-1">
                {currencySymbol}
                {moneyAnalysis.stockConsumed.toLocaleString()}
              </div>
              <span className="text-[10px] text-amber-800/80 mt-1 block">Utilized by kitchens & wastage</span>
            </div>
          </div>

          {/* Breakdown Section: By Department & By Category */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Department Breakdown */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-stone-700" />
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    Consumption by Kitchen Line / Station
                  </h3>
                </div>
                <Badge variant="neutral" size="sm">
                  {moneyAnalysis.departmentBreakdown.length} stations
                </Badge>
              </div>

              {moneyAnalysis.departmentBreakdown.length === 0 ? (
                <p className="text-xs text-stone-400 py-6 text-center">No department issues in this period.</p>
              ) : (
                <div className="space-y-3">
                  {moneyAnalysis.departmentBreakdown.map((dept) => (
                    <div key={dept.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-stone-800">{dept.name}</span>
                        <span className="font-mono text-stone-900">
                          {currencySymbol}
                          {dept.value.toLocaleString()}{' '}
                          <span className="text-stone-400 text-[11px]">({dept.percent}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-amber-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(4, dept.percent))}%` }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Wastage line */}
                  {moneyAnalysis.wastageValue > 0 && (
                    <div className="pt-2 border-t border-stone-100 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold text-rose-700 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Spoilage & Wastage Loss
                        </span>
                        <span className="font-mono text-rose-700">
                          {currencySymbol}
                          {moneyAnalysis.wastageValue.toLocaleString()}{' '}
                          <span className="text-rose-500 text-[11px]">({moneyAnalysis.wastagePercent}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-rose-600 h-2 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(4, moneyAnalysis.wastagePercent))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Category Breakdown */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-stone-700" />
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    Consumption by Raw Material Category
                  </h3>
                </div>
                <Badge variant="neutral" size="sm">
                  {categoryIssuesMap.length} categories
                </Badge>
              </div>

              {categoryIssuesMap.length === 0 ? (
                <p className="text-xs text-stone-400 py-6 text-center">No category dispatches recorded.</p>
              ) : (
                <div className="space-y-3">
                  {categoryIssuesMap.map((cat) => {
                    const totalDispatched = moneyAnalysis.totalRecordedOutflow || 1;
                    const catPct = Number(((cat.value / totalDispatched) * 100).toFixed(1));
                    return (
                      <div key={cat.category} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-stone-800">{cat.category}</span>
                          <span className="font-mono text-stone-900">
                            {currencySymbol}
                            {cat.value.toLocaleString()}{' '}
                            <span className="text-stone-400 text-[11px]">({catPct}%)</span>
                          </span>
                        </div>
                        <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-stone-800 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(4, catPct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
