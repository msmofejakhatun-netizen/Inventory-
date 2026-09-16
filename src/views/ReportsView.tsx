import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  Calendar,
  Filter,
  PieChart,
  DollarSign,
  TrendingDown,
  Building2,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Issue, Purchase, Wastage, Vendor, Department, Item } from '../types';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Badge } from '../components/common/Badge';

export const ReportsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId } = useAuth();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [wastages, setWastages] = useState<Wastage[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeTab, setActiveTab] = useState<'CONSUMPTION' | 'PURCHASES' | 'WASTAGE' | 'VENDORS'>('CONSUMPTION');

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (snap) => {
      setIssues(snap.docs.map((d) => d.data() as Issue));
    });
    const unsubPurchases = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'purchases'), (snap) => {
      setPurchases(snap.docs.map((d) => d.data() as Purchase));
    });
    const unsubWastage = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'wastage'), (snap) => {
      setWastages(snap.docs.map((d) => d.data() as Wastage));
    });
    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
    });
    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      setDepartments(snap.docs.map((d) => d.data() as Department));
    });
    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
    });

    return () => {
      unsubIssues();
      unsubPurchases();
      unsubWastage();
      unsubVendors();
      unsubDepts();
      unsubItems();
    };
  }, [activeRestaurantId]);

  // Groupings for Department Consumption
  const deptConsumptionMap: { [deptName: string]: { totalValue: number; itemsCount: number } } = {};
  issues.forEach((iss) => {
    const dName = iss.departmentName || 'General';
    if (!deptConsumptionMap[dName]) {
      deptConsumptionMap[dName] = { totalValue: 0, itemsCount: 0 };
    }
    deptConsumptionMap[dName].totalValue += Number(iss.value) || 0;
    deptConsumptionMap[dName].itemsCount += 1;
  });

  // Groupings for Vendor Purchases
  const vendorPurchaseMap: { [vendorName: string]: { totalAmount: number; billsCount: number; currentDue: number } } = {};
  vendors.forEach((v) => {
    vendorPurchaseMap[v.name] = { totalAmount: 0, billsCount: 0, currentDue: v.currentDue || 0 };
  });
  purchases.forEach((p) => {
    const vName = p.vendorName || 'Other';
    if (!vendorPurchaseMap[vName]) {
      vendorPurchaseMap[vName] = { totalAmount: 0, billsCount: 0, currentDue: 0 };
    }
    vendorPurchaseMap[vName].totalAmount += Number(p.netAmount) || 0;
    vendorPurchaseMap[vName].billsCount += 1;
  });

  // Groupings for Wastage by Reason
  const wastageReasonMap: { [reason: string]: { totalValue: number; count: number } } = {};
  wastages.forEach((w) => {
    if (!wastageReasonMap[w.reason]) {
      wastageReasonMap[w.reason] = { totalValue: 0, count: 0 };
    }
    wastageReasonMap[w.reason].totalValue += Number(w.value) || 0;
    wastageReasonMap[w.reason].count += 1;
  });

  const exportCurrentReportCsv = () => {
    if (activeTab === 'CONSUMPTION') {
      const headers = ['Department', 'Total Consumption Value', 'Issues Count'];
      const rows = Object.entries(deptConsumptionMap).map(([dept, data]) => [dept, data.totalValue, data.itemsCount]);
      exportToCsv(`dept_consumption_${activeRestaurant?.name || 'store'}`, headers, rows);
    } else if (activeTab === 'PURCHASES') {
      const headers = ['Vendor Name', 'Total Purchases', 'Bills Count', 'Current Outstanding Due'];
      const rows = Object.entries(vendorPurchaseMap).map(([v, data]) => [
        v,
        data.totalAmount,
        data.billsCount,
        data.currentDue,
      ]);
      exportToCsv(`vendor_purchases_${activeRestaurant?.name || 'store'}`, headers, rows);
    } else if (activeTab === 'WASTAGE') {
      const headers = ['Wastage Reason', 'Total Financial Loss', 'Incidents Count'];
      const rows = Object.entries(wastageReasonMap).map(([r, data]) => [r, data.totalValue, data.count]);
      exportToCsv(`wastage_summary_${activeRestaurant?.name || 'store'}`, headers, rows);
    }
  };

  const exportCurrentReportPdf = () => {
    if (activeTab === 'CONSUMPTION') {
      const headers = ['Department', 'Total Consumption Value', 'Dispatches'];
      const rows = Object.entries(deptConsumptionMap).map(([dept, data]) => [
        dept,
        `${currencySymbol}${data.totalValue.toFixed(2)}`,
        data.itemsCount,
      ]);
      exportToPdf('Department Consumption Summary', activeRestaurant?.name || 'Store', headers, rows);
    } else if (activeTab === 'PURCHASES') {
      const headers = ['Vendor', 'Total Purchases', 'Bills Count', 'Outstanding Due'];
      const rows = Object.entries(vendorPurchaseMap).map(([v, data]) => [
        v,
        `${currencySymbol}${data.totalAmount.toFixed(2)}`,
        data.billsCount,
        `${currencySymbol}${data.currentDue.toFixed(2)}`,
      ]);
      exportToPdf('Vendor Procurement Ledger', activeRestaurant?.name || 'Store', headers, rows);
    } else if (activeTab === 'WASTAGE') {
      const headers = ['Wastage Reason', 'Financial Loss', 'Incidents'];
      const rows = Object.entries(wastageReasonMap).map(([r, data]) => [
        r,
        `${currencySymbol}${data.totalValue.toFixed(2)}`,
        data.count,
      ]);
      exportToPdf('Kitchen Wastage & Spoilage Report', activeRestaurant?.name || 'Store', headers, rows);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Audit & Business Reports</h1>
            <Badge variant="neutral" size="sm">
              Real Ledger Analytics
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Department-level material consumption, supplier expenditure aggregates, and kitchen spoilage audits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCurrentReportCsv}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={exportCurrentReportPdf}
            className="flex items-center gap-1 px-3 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone-200 bg-white px-4 rounded-t-xl">
        <button
          onClick={() => setActiveTab('CONSUMPTION')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'CONSUMPTION'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Department Consumption
        </button>
        <button
          onClick={() => setActiveTab('PURCHASES')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'PURCHASES'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Vendor Purchase Volume & Dues
        </button>
        <button
          onClick={() => setActiveTab('WASTAGE')}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'WASTAGE'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Kitchen Spoilage & Wastage
        </button>
      </div>

      {/* Report Content Table */}
      <div className="bg-white rounded-b-xl border border-t-0 border-stone-200 overflow-hidden shadow-2xs">
        {activeTab === 'CONSUMPTION' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Kitchen Department</th>
                  <th className="py-3 px-4 text-right">Stock Issue Dispatches</th>
                  <th className="py-3 px-4 text-right">Total Material Consumption Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Object.keys(deptConsumptionMap).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-stone-400">
                      No consumption records found.
                    </td>
                  </tr>
                ) : (
                  Object.entries(deptConsumptionMap).map(([dept, data]) => (
                    <tr key={dept} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-stone-900">{dept}</td>
                      <td className="py-3 px-4 text-right font-medium text-stone-600">{data.itemsCount} issues</td>
                      <td className="py-3 px-4 text-right font-bold text-amber-900 text-sm">
                        {currencySymbol}{data.totalValue.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'PURCHASES' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Vendor / Supplier</th>
                  <th className="py-3 px-4 text-right">Inward Bills</th>
                  <th className="py-3 px-4 text-right">Total Procurement Volume</th>
                  <th className="py-3 px-4 text-right">Current Outstanding Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Object.keys(vendorPurchaseMap).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-stone-400">
                      No purchase records found.
                    </td>
                  </tr>
                ) : (
                  Object.entries(vendorPurchaseMap).map(([v, data]) => (
                    <tr key={v} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-stone-900">{v}</td>
                      <td className="py-3 px-4 text-right text-stone-600">{data.billsCount} bills</td>
                      <td className="py-3 px-4 text-right font-bold text-stone-900">
                        {currencySymbol}{data.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={data.currentDue > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          {currencySymbol}{data.currentDue.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'WASTAGE' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Root Cause / Spoilage Reason</th>
                  <th className="py-3 px-4 text-right">Incident Frequency</th>
                  <th className="py-3 px-4 text-right">Financial Scrap Value Written Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Object.keys(wastageReasonMap).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-stone-400">
                      No wastage records found.
                    </td>
                  </tr>
                ) : (
                  Object.entries(wastageReasonMap).map(([reason, data]) => (
                    <tr key={reason} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-stone-900">{reason}</td>
                      <td className="py-3 px-4 text-right text-stone-600">{data.count} incidents</td>
                      <td className="py-3 px-4 text-right font-bold text-rose-700 text-sm">
                        {currencySymbol}{data.totalValue.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
