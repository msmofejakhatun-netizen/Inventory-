import React, { useEffect, useState } from 'react';
import {
  Boxes,
  Search,
  Filter,
  Plus,
  Download,
  Upload,
  AlertTriangle,
  Lock,
  Edit2,
  CheckCircle,
  FileSpreadsheet,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Department, Vendor, Issue } from '../types';
import {
  calculateStockValue,
  calculateAverageDailyConsumption,
  calculateStockDays,
  calculateExcessStock,
} from '../services/calculations';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const StockView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, hasRole } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'LOW' | 'EXCESS' | 'SUFFICIENT'>('ALL');

  // Add / Edit Modal
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [unit, setUnit] = useState('Kg');
  const [departmentId, setDepartmentId] = useState('');
  const [primaryVendorId, setPrimaryVendorId] = useState('');
  const [minimumStock, setMinimumStock] = useState(5);
  const [maximumStock, setMaximumStock] = useState(25);
  const [targetStockDays, setTargetStockDays] = useState(5);
  const [openingStock, setOpeningStock] = useState(0);
  const [openingRate, setOpeningRate] = useState(0);
  const [taxPercent, setTaxPercent] = useState(5);

  // CSV Import Modal
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as Item));
      setLoading(false);
    });

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      setDepartments(snap.docs.map((d) => d.data() as Department));
    });

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
    });

    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (snap) => {
      setIssues(snap.docs.map((d) => d.data() as Issue));
    });

    return () => {
      unsubItems();
      unsubDepts();
      unsubVendors();
      unsubIssues();
    };
  }, [activeRestaurantId]);

  const openAddModal = () => {
    setEditingItem(null);
    setName('');
    setCategory('Grocery');
    setUnit('Kg');
    setDepartmentId(departments[0]?.id || '');
    setPrimaryVendorId(vendors[0]?.id || '');
    setMinimumStock(5);
    setMaximumStock(25);
    setTargetStockDays(5);
    setOpeningStock(0);
    setOpeningRate(0);
    setTaxPercent(5);
    setIsItemModalOpen(true);
  };

  const openEditModal = (item: Item) => {
    setEditingItem(item);
    setName(item.name);
    setCategory(item.category);
    setUnit(item.unit);
    setDepartmentId(item.departmentId || '');
    setPrimaryVendorId(item.primaryVendorId || '');
    setMinimumStock(item.minimumStock || 0);
    setMaximumStock(item.maximumStock || 0);
    setTargetStockDays(item.targetStockDays || 5);
    setOpeningStock(item.currentStock || 0);
    setOpeningRate(item.averageStockRate || item.lastPurchaseRate || 0);
    setTaxPercent(item.taxPercent || 0);
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !name.trim()) return;

    const deptObj = departments.find((d) => d.id === departmentId);
    const vendorObj = vendors.find((v) => v.id === primaryVendorId);
    const now = new Date().toISOString();

    if (editingItem) {
      // Edit existing item
      const itemRef = doc(db, 'restaurants', activeRestaurantId, 'items', editingItem.id);
      await updateDoc(itemRef, {
        name: name.trim(),
        category,
        unit,
        departmentId: departmentId || '',
        departmentName: deptObj?.name || '',
        primaryVendorId: primaryVendorId || '',
        primaryVendorName: vendorObj?.name || '',
        minimumStock: Number(minimumStock),
        maximumStock: Number(maximumStock),
        targetStockDays: Number(targetStockDays),
        taxPercent: Number(taxPercent),
        updatedAt: now,
      });
    } else {
      // Create new item
      const itemRef = doc(collection(db, 'restaurants', activeRestaurantId, 'items'));
      const newItem: Item = {
        id: itemRef.id,
        name: name.trim(),
        category,
        unit,
        departmentId: departmentId || '',
        departmentName: deptObj?.name || '',
        primaryVendorId: primaryVendorId || '',
        primaryVendorName: vendorObj?.name || '',
        currentStock: Number(openingStock),
        minimumStock: Number(minimumStock),
        maximumStock: Number(maximumStock),
        targetStockDays: Number(targetStockDays),
        lastPurchaseRate: Number(openingRate),
        averageStockRate: Number(openingRate),
        taxPercent: Number(taxPercent),
        reorderLevel: Number(minimumStock),
        status: 'active',
        restaurantId: activeRestaurantId,
        updatedAt: now,
      };
      await setDoc(itemRef, newItem);
    }

    setIsItemModalOpen(false);
  };

  // CSV Bulk Import
  const handleCsvImport = async () => {
    if (!activeRestaurantId || !csvText.trim()) return;
    try {
      setImportStatus('Importing items to Firestore...');
      const lines = csvText.trim().split('\n');
      const batch = writeBatch(db);
      let count = 0;

      // Skip header if contains 'name'
      const startIndex = lines[0].toLowerCase().includes('name') ? 1 : 0;

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
        const [itemName, itemCat, itemUnit, currentQty, avgRate, minStock, targetDays] = parts;

        if (itemName) {
          const itemRef = doc(collection(db, 'restaurants', activeRestaurantId, 'items'));
          const itemDoc: Item = {
            id: itemRef.id,
            name: itemName,
            category: itemCat || 'General',
            unit: itemUnit || 'Kg',
            currentStock: Number(currentQty) || 0,
            averageStockRate: Number(avgRate) || 0,
            lastPurchaseRate: Number(avgRate) || 0,
            minimumStock: Number(minStock) || 5,
            maximumStock: (Number(minStock) || 5) * 4,
            targetStockDays: Number(targetDays) || 5,
            taxPercent: 5,
            reorderLevel: Number(minStock) || 5,
            status: 'active',
            restaurantId: activeRestaurantId,
            updatedAt: new Date().toISOString(),
          };
          batch.set(itemRef, itemDoc);
          count++;
        }
      }

      await batch.commit();
      setImportStatus(`Successfully imported ${count} items!`);
      setTimeout(() => {
        setIsCsvModalOpen(false);
        setImportStatus(null);
        setCsvText('');
      }, 1500);
    } catch (e: any) {
      setImportStatus(`Import failed: ${e?.message}`);
    }
  };

  // Filtered List with Metrics
  const processedItems = items.map((item) => {
    const value = calculateStockValue(item.currentStock, item.averageStockRate || item.lastPurchaseRate || 0);
    const { avgDailyQty, hasData } = calculateAverageDailyConsumption(issues, item.id, 14);
    const stockDaysObj = calculateStockDays(item.currentStock, avgDailyQty);
    const excessObj = calculateExcessStock(item, avgDailyQty);

    let statusType: 'LOW' | 'EXCESS' | 'SUFFICIENT' = 'SUFFICIENT';
    if (item.minimumStock > 0 && item.currentStock <= item.minimumStock) {
      statusType = 'LOW';
    } else if (excessObj.isExcess) {
      statusType = 'EXCESS';
    }

    return {
      ...item,
      stockValue: value,
      avgDailyQty,
      hasConsumptionData: hasData,
      stockDaysLabel: stockDaysObj.label,
      excessValue: excessObj.excessValue,
      statusType,
    };
  });

  const filteredItems = processedItems.filter((item) => {
    const matchSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchDept = selectedDept === 'ALL' || item.departmentId === selectedDept;
    const matchStatus = selectedStatus === 'ALL' || item.statusType === selectedStatus;
    return matchSearch && matchDept && matchStatus;
  });

  const handleExportCsv = () => {
    const headers = ['Item Name', 'Category', 'Unit', 'Current Stock', 'Avg Rate', 'Stock Value', 'Stock Days', 'Status'];
    const rows = filteredItems.map((i) => [
      i.name,
      i.category,
      i.unit,
      i.currentStock,
      i.averageStockRate || i.lastPurchaseRate,
      i.stockValue,
      i.stockDaysLabel,
      i.statusType,
    ]);
    exportToCsv(`stock_inventory_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Item Name', 'Category', 'Unit', 'Stock', 'Rate', 'Value', 'Days'];
    const rows = filteredItems.map((i) => [
      i.name,
      i.category,
      i.unit,
      i.currentStock,
      `${currencySymbol}${i.averageStockRate || i.lastPurchaseRate}`,
      `${currencySymbol}${i.stockValue}`,
      i.stockDaysLabel,
    ]);
    exportToPdf('Current Stock Inventory Report', activeRestaurant?.name || 'Store', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Current Stock Inventory</h1>
            <Badge variant="neutral" size="sm">
              {items.length} Total SKUs
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Real-time stock ledger calculated using Weighted Average Costing and daily consumption rates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasRole(['OWNER', 'MANAGER', 'STOREKEEPER']) && (
            <>
              <button
                id="add-item-btn"
                onClick={openAddModal}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Item
              </button>
              <button
                id="csv-import-btn"
                onClick={() => setIsCsvModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Upload className="w-4 h-4" /> CSV Import
              </button>
            </>
          )}
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

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="stock-search-input"
            type="text"
            placeholder="Search items by name or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            id="dept-filter-select"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-amber-500 text-stone-700"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <select
            id="status-filter-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg bg-white focus:outline-none focus:border-amber-500 text-stone-700"
          >
            <option value="ALL">All Status</option>
            <option value="LOW">Low Stock / Reorder</option>
            <option value="EXCESS">Excess Stock</option>
            <option value="SUFFICIENT">Sufficient</option>
          </select>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Item Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4 text-right">Current Stock</th>
                <th className="py-3 px-4 text-right">Avg Rate</th>
                <th className="py-3 px-4 text-right">Stock Value</th>
                <th className="py-3 px-4">Stock Days</th>
                <th className="py-3 px-4">Status</th>
                {hasRole(['OWNER', 'MANAGER']) && <th className="py-3 px-4 text-center">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-400">
                    Loading stock ledger...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-stone-400">
                    No items matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-stone-900">{item.name}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-medium">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-stone-500">{item.departmentName || 'General Store'}</td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {item.currentStock} <span className="text-[11px] font-normal text-stone-500">{item.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-stone-700">
                      {currencySymbol}{(item.averageStockRate || item.lastPurchaseRate || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-stone-900">
                      {currencySymbol}{item.stockValue.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                      {item.stockDaysLabel}
                    </td>
                    <td className="py-3 px-4">
                      {item.statusType === 'LOW' ? (
                        <Badge variant="danger" size="sm">
                          Low Stock
                        </Badge>
                      ) : item.statusType === 'EXCESS' ? (
                        <Badge variant="warning" size="sm">
                          Excess Stock
                        </Badge>
                      ) : (
                        <Badge variant="success" size="sm">
                          Sufficient
                        </Badge>
                      )}
                    </td>
                    {hasRole(['OWNER', 'MANAGER']) && (
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => openEditModal(item)}
                          className="p-1 text-stone-400 hover:text-stone-700 rounded"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        title={editingItem ? 'Edit Item Master' : 'Add New Inventory Item'}
        subtitle="Manage item specifications, target stock days, and reorder levels"
        maxWidth="xl"
      >
        <form onSubmit={handleSaveItem} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Item Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Basmati Rice Supreme"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Category
              </label>
              <input
                type="text"
                placeholder="Grocery, Dairy, Meat, Bar, Bakery"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Unit of Measure
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="Kg">Kg</option>
                <option value="Ltr">Ltr</option>
                <option value="Gm">Gm</option>
                <option value="Ml">Ml</option>
                <option value="Pcs">Pcs</option>
                <option value="Box">Box</option>
                <option value="Tin">Tin</option>
                <option value="Bottle">Bottle</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Department
              </label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="">General Store</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Primary Vendor
              </label>
              <select
                value={primaryVendorId}
                onChange={(e) => setPrimaryVendorId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="">Select Vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Minimum Stock ({unit})
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={minimumStock}
                onChange={(e) => setMinimumStock(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Maximum Stock ({unit})
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={maximumStock}
                onChange={(e) => setMaximumStock(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Target Stock Days
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={targetStockDays}
                onChange={(e) => setTargetStockDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
            </div>
          </div>

          {!editingItem && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Opening Stock Quantity
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={openingStock}
                  onChange={(e) => setOpeningStock(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Opening Rate ({currencySymbol} / {unit})
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={openingRate}
                  onChange={(e) => setOpeningRate(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
                />
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsItemModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900"
            >
              Cancel
            </button>
            <button
              id="save-item-submit-btn"
              type="submit"
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              {editingItem ? 'Save Changes' : 'Create Item'}
            </button>
          </div>
        </form>
      </Modal>

      {/* CSV Import Modal */}
      <Modal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        title="Bulk Import Items (CSV / Excel Format)"
        subtitle="Paste comma-separated rows to import existing store items"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="text-xs text-stone-500 bg-stone-50 p-3 rounded-lg border border-stone-200">
            <p className="font-semibold text-stone-700 mb-1">Format Specification:</p>
            <code>ItemName, Category, Unit, OpeningQty, OpeningRate, MinStock, TargetStockDays</code>
            <p className="mt-2 text-stone-400 text-[11px]">
              Example: Amul Butter 500g, Dairy, Pcs, 40, 275, 10, 5
            </p>
          </div>

          <textarea
            rows={8}
            placeholder="Paste your CSV rows here..."
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full p-3 font-mono text-xs border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500"
          />

          {importStatus && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
              {importStatus}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsCsvModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              id="process-csv-import-btn"
              onClick={handleCsvImport}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Import Items
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
