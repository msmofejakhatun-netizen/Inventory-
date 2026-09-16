import React, { useEffect, useState } from 'react';
import {
  Boxes,
  Lock,
  ShoppingCart,
  Building2,
  PieChart,
  AlertTriangle,
  AlertOctagon,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Activity,
  Calendar,
  CheckCircle2,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import {
  Item,
  Vendor,
  Purchase,
  Issue,
  EmergencyIssue,
  Wastage,
  StockTransaction,
  NotificationItem,
  StoreHealthScoreBreakdown,
  StockCount,
} from '../types';
import {
  calculateStockValue,
  calculateExcessStock,
  calculateAverageDailyConsumption,
  calculateStoreHealthScore,
} from '../services/calculations';
import { StatCard } from '../components/common/StatCard';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import { NavTab } from '../components/layout/Sidebar';

interface DashboardViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { activeRestaurant, activeRestaurantId } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [emergencyIssues, setEmergencyIssues] = useState<EmergencyIssue[]>([]);
  const [wastages, setWastages] = useState<Wastage[]>([]);
  const [recentTxns, setRecentTxns] = useState<StockTransaction[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [stockCounts, setStockCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Brief
  const [dailyBrief, setDailyBrief] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);

  // Health Score Modal
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);

  // Real-time Firestore Listeners
  useEffect(() => {
    if (!activeRestaurantId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
    });

    const unsubPurchases = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'purchases'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setPurchases(snap.docs.map((d) => d.data() as Purchase));
      }
    );

    const unsubIssues = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'issues'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setIssues(snap.docs.map((d) => d.data() as Issue));
      }
    );

    const unsubEmerg = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'emergencyIssues'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setEmergencyIssues(snap.docs.map((d) => d.data() as EmergencyIssue));
      }
    );

    const unsubWastage = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'wastage'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setWastages(snap.docs.map((d) => d.data() as Wastage));
      }
    );

    const unsubTxns = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'stockTransactions'), orderBy('createdAt', 'desc'), limit(10)),
      (snap) => {
        setRecentTxns(snap.docs.map((d) => d.data() as StockTransaction));
        setLoading(false);
      }
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'notifications'), orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        setNotifications(snap.docs.map((d) => d.data() as NotificationItem));
      }
    );

    const unsubStockCounts = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'stockCounts'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setStockCounts(snap.docs.map((d) => d.data() as StockCount));
      }
    );

    return () => {
      unsubItems();
      unsubVendors();
      unsubPurchases();
      unsubIssues();
      unsubEmerg();
      unsubWastage();
      unsubTxns();
      unsubNotifs();
      unsubStockCounts();
    };
  }, [activeRestaurantId]);

  // Pure mathematical calculations on real data
  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  const totalStockValue = items.reduce((sum, item) => {
    return sum + calculateStockValue(item.currentStock, item.averageStockRate || item.lastPurchaseRate || 0);
  }, 0);

  // Cash blocked calculation based on consumption history
  let totalCashBlocked = 0;
  items.forEach((item) => {
    const { avgDailyQty } = calculateAverageDailyConsumption(issues, item.id, 14);
    const { excessValue } = calculateExcessStock(item, avgDailyQty);
    totalCashBlocked += excessValue;
  });

  // Today's Purchases
  const todayIsoPrefix = new Date().toISOString().slice(0, 10);
  const todayPurchasesTotal = purchases
    .filter((p) => p.billDate === todayIsoPrefix || p.createdAt.startsWith(todayIsoPrefix))
    .reduce((sum, p) => sum + (Number(p.netAmount) || 0), 0);

  // Total Vendor Due
  const totalVendorDue = vendors.reduce((sum, v) => sum + (Number(v.currentDue) || 0), 0);

  // Total Department Consumption Value
  const totalIssuesValue = issues.reduce((sum, i) => sum + (Number(i.value) || 0), 0);

  // Price Hike Alerts Count
  const priceHikeAlertsCount = notifications.filter((n) => n.type === 'PRICE_HIKE' && !n.isRead).length;

  // Emergency Issues 7 Days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysIso = sevenDaysAgo.toISOString();
  const emergencyIssues7Days = emergencyIssues.filter((e) => e.createdAt >= sevenDaysIso);

  // Wastage 30 Days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysIso = thirtyDaysAgo.toISOString();
  const totalWastageValue30Days = wastages
    .filter((w) => w.createdAt >= thirtyDaysIso)
    .reduce((sum, w) => sum + (Number(w.value) || 0), 0);

  // Total Purchases 30 Days
  const totalPurchases30Days = purchases
    .filter((p) => p.createdAt >= thirtyDaysIso)
    .reduce((sum, p) => sum + (Number(p.netAmount) || 0), 0);

  // Low stock items count
  const itemsWithLowStockCount = items.filter(
    (item) => item.minimumStock > 0 && item.currentStock <= item.minimumStock
  ).length;

  // Real variance incidents from physical stock audits in last 30 days
  const varianceIncidentsCount30Days = stockCounts.filter(
    (sc) => sc.createdAt >= thirtyDaysIso && Math.abs(Number(sc.varianceQuantity) || 0) > 0.001
  ).length;

  // Store Health Score
  const healthBreakdown: StoreHealthScoreBreakdown = calculateStoreHealthScore({
    totalStockValue,
    totalCashBlocked,
    itemsWithLowStockCount,
    totalItemsCount: items.length,
    totalVendorDue,
    totalPurchases30Days,
    totalWastageValue30Days,
    totalIssuesValue30Days: totalIssuesValue,
    emergencyIssuesCount7Days: emergencyIssues7Days.length,
    varianceIncidentsCount30Days,
    priceHikesCount30Days: priceHikeAlertsCount,
  });

  // Recommended Purchase Today
  const recommendedItems = items.filter((item) => {
    const { avgDailyQty } = calculateAverageDailyConsumption(issues, item.id, 14);
    if (avgDailyQty > 0) {
      const stockDays = item.currentStock / avgDailyQty;
      return stockDays <= 1.5;
    }
    return item.minimumStock > 0 && item.currentStock <= item.minimumStock;
  });

  const recommendedPurchaseTotal = recommendedItems.reduce((sum, item) => {
    const rate = item.averageStockRate || item.lastPurchaseRate || 0;
    const target = item.maximumStock || item.minimumStock * 2 || 10;
    const needed = Math.max(0, target - item.currentStock);
    return sum + needed * rate;
  }, 0);

  // Fetch AI Daily Brief on click or initial load
  const fetchAiDailyBrief = async () => {
    try {
      setLoadingBrief(true);
      const res = await fetch('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            restaurantName: activeRestaurant?.name,
            totalStockValue,
            totalCashBlocked,
            totalVendorDue,
            todayPurchasesTotal,
            priceHikesCount: priceHikeAlertsCount,
            emergencyIssuesCount: emergencyIssues7Days.length,
            wastageCount: wastages.length,
            recommendedPurchaseTotal,
            healthScore: healthBreakdown.score,
          },
        }),
      });
      const data = await res.json();
      if (data.brief) {
        setDailyBrief(data.brief);
      }
    } catch (err) {
      console.error('Failed to load AI brief:', err);
    } finally {
      setLoadingBrief(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Boss Dashboard
            </h1>
            <Badge variant="neutral" size="sm">
              Live Store Sync
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Real-time financial stock control, procurement safeguards, and raw material audits.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="quick-inward-btn"
            onClick={() => onNavigate('purchases')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Inward Purchase
          </button>
          <button
            id="quick-issue-btn"
            onClick={() => onNavigate('issues')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Issue Stock
          </button>
          <button
            id="quick-emergency-btn"
            onClick={() => onNavigate('emergency_issues')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg text-xs font-semibold transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Emergency Requisition
          </button>
        </div>
      </div>

      {/* AI Daily Brief Card */}
      <div className="bg-gradient-to-r from-stone-900 to-stone-950 text-white rounded-xl p-5 border border-stone-800 shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-800 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500 text-stone-950">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                AI Store Briefing
              </h2>
              <p className="text-[11px] text-stone-400">
                Ground-truth operational briefing based on real Firebase transactions
              </p>
            </div>
          </div>
          <button
            id="refresh-ai-brief-btn"
            onClick={fetchAiDailyBrief}
            disabled={loadingBrief}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-[11px] text-stone-200 font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loadingBrief ? 'animate-spin' : ''}`} />
            <span>{dailyBrief ? 'Regenerate Brief' : 'Generate Morning Brief'}</span>
          </button>
        </div>

        {dailyBrief ? (
          <div className="text-xs text-stone-200 whitespace-pre-line leading-relaxed font-mono bg-stone-950/60 p-3.5 rounded-lg border border-stone-800/80">
            {dailyBrief}
          </div>
        ) : (
          <div className="text-xs text-stone-400 py-1 flex items-center justify-between">
            <span>
              Click "Generate Morning Brief" to analyze store value, excess stock, vendor dues, and price hikes via AI.
            </span>
            <button
              onClick={fetchAiDailyBrief}
              className="text-amber-400 hover:text-amber-300 font-semibold underline text-xs ml-2"
            >
              Analyze Now →
            </button>
          </div>
        )}
      </div>

      {/* Primary KPI Grid (All values derived from real DB) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          id="stat-stock-value"
          title="Current Stock Value"
          value={`${currencySymbol}${totalStockValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          subtitle={`${items.length} active inventory items`}
          icon={Boxes}
          colorClass="bg-blue-50 text-blue-700 border-blue-200"
          onClick={() => onNavigate('stock')}
        />

        <StatCard
          id="stat-cash-blocked"
          title="Cash Blocked in Stock"
          value={`${currencySymbol}${totalCashBlocked.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          subtitle={
            totalStockValue > 0
              ? `${((totalCashBlocked / totalStockValue) * 100).toFixed(1)}% of total inventory`
              : 'Excess beyond target days'
          }
          icon={Lock}
          colorClass="bg-amber-50 text-amber-700 border-amber-200"
          onClick={() => onNavigate('stock')}
        />

        <StatCard
          id="stat-vendor-due"
          title="Total Vendor Due"
          value={`${currencySymbol}${totalVendorDue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          subtitle={`Across ${vendors.length} registered vendors`}
          icon={Building2}
          colorClass="bg-rose-50 text-rose-700 border-rose-200"
          onClick={() => onNavigate('vendor_payments')}
        />

        <StatCard
          id="stat-store-health"
          title="Store Health Score"
          value={`${healthBreakdown.score} / 100`}
          subtitle="Click for score breakdown"
          icon={Activity}
          colorClass={
            healthBreakdown.score >= 80
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : healthBreakdown.score >= 60
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }
          onClick={() => setIsHealthModalOpen(true)}
        />
      </div>

      {/* Secondary Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-stone-500 uppercase">Today's Purchases</p>
            <p className="text-lg font-bold text-stone-900 mt-1">
              {currencySymbol}{todayPurchasesTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-stone-100 text-stone-600">
            <ShoppingCart className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-stone-500 uppercase">Price Hike Alerts</p>
            <p className="text-lg font-bold text-rose-600 mt-1">
              {priceHikeAlertsCount} active
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-stone-500 uppercase">Emergency Issues (7d)</p>
            <p className="text-lg font-bold text-amber-600 mt-1">
              {emergencyIssues7Days.length} requisitions
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
            <AlertOctagon className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-stone-500 uppercase">Recommended Purchase</p>
            <p className="text-lg font-bold text-emerald-600 mt-1">
              {currencySymbol}{recommendedPurchaseTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
            <Boxes className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Two Column Section: Live Stock Ledger Stream & High Risk Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Real-Time Transactions */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-stone-500" />
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Live Store Transactions
              </h3>
            </div>
            <button
              onClick={() => onNavigate('stock')}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium"
            >
              View Stock →
            </button>
          </div>

          {recentTxns.length === 0 ? (
            <div className="text-center py-8 text-xs text-stone-400">
              No transactions recorded yet. Record purchases or issues to see live stream.
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentTxns.map((txn) => (
                <div
                  key={txn.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-stone-100 bg-stone-50/50 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        txn.type === 'PURCHASE_RECEIVE'
                          ? 'bg-emerald-500'
                          : txn.type === 'DEPT_ISSUE'
                          ? 'bg-blue-500'
                          : txn.type === 'EMERGENCY_ISSUE'
                          ? 'bg-rose-500'
                          : txn.type === 'WASTAGE'
                          ? 'bg-amber-500'
                          : 'bg-stone-500'
                      }`}
                    />
                    <div>
                      <p className="font-semibold text-stone-900">{txn.itemName}</p>
                      <p className="text-[11px] text-stone-500">
                        {txn.type.replace('_', ' ')} • {txn.reason || 'Standard'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-bold ${
                        txn.quantity > 0 ? 'text-emerald-700' : 'text-stone-700'
                      }`}
                    >
                      {txn.quantity > 0 ? `+${txn.quantity}` : txn.quantity}
                    </p>
                    <p className="text-[10px] text-stone-400">
                      {new Date(txn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock & Stockout Risk Watchlist */}
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Reorder Watchlist (Low Stock)
              </h3>
            </div>
            <button
              onClick={() => onNavigate('stock')}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium"
            >
              All Items ({items.length}) →
            </button>
          </div>

          {items.filter((i) => i.minimumStock > 0 && i.currentStock <= i.minimumStock).length === 0 ? (
            <div className="text-center py-8 text-xs text-stone-400">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5 opacity-60" />
              No items currently below minimum stock threshold.
            </div>
          ) : (
            <div className="space-y-2.5">
              {items
                .filter((i) => i.minimumStock > 0 && i.currentStock <= i.minimumStock)
                .slice(0, 5)
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-amber-200/70 bg-amber-50/30 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-stone-900">{item.name}</p>
                      <p className="text-[11px] text-stone-500">
                        Category: {item.category} • Dept: {item.departmentName || 'Main'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-rose-700">
                        {item.currentStock} {item.unit}
                      </p>
                      <p className="text-[10px] text-stone-500">Min: {item.minimumStock} {item.unit}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Explainable Store Health Score Modal */}
      <Modal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
        title="Store Health Score Analysis"
        subtitle="Transparent evaluation of stock control, blocked capital, and kitchen discipline"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="text-center py-4 bg-stone-50 rounded-xl border border-stone-200">
            <span className="text-3xl font-black text-stone-900">{healthBreakdown.score}</span>
            <span className="text-sm text-stone-500 font-bold"> / 100</span>
            <p className="text-xs text-stone-500 mt-1">
              Calculated dynamically from live inventory ratios and variance history
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Stock Control & Reorder Stability</span>
              <span className="font-bold text-stone-900">{healthBreakdown.stockControlScore} / 25 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Excess Stock & Cash Blocked</span>
              <span className="font-bold text-stone-900">{healthBreakdown.excessStockScore} / 20 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Vendor Dues Aging & Solvency</span>
              <span className="font-bold text-stone-900">{healthBreakdown.vendorDueScore} / 15 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Kitchen Wastage Ratio</span>
              <span className="font-bold text-stone-900">{healthBreakdown.wastageScore} / 15 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Emergency Requisitions Frequency</span>
              <span className="font-bold text-stone-900">{healthBreakdown.emergencyScore} / 10 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Physical Stock Audit Variances</span>
              <span className="font-bold text-stone-900">{healthBreakdown.varianceScore} / 10 pts</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-stone-100">
              <span className="text-stone-600 font-medium">Purchase Price Hike Impact</span>
              <span className="font-bold text-stone-900">{healthBreakdown.priceHikeScore} / 5 pts</span>
            </div>
          </div>

          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
            <h4 className="text-xs font-bold text-amber-900 mb-1">Key Factors & Recommendations:</h4>
            <ul className="text-xs text-amber-800 space-y-1 list-disc pl-4">
              {healthBreakdown.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
};
