import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Search,
  Plus,
  Download,
  Upload,
  AlertTriangle,
  Edit2,
  CheckCircle2,
  FileSpreadsheet,
  MoreVertical,
  Eye,
  Trash2,
  Archive,
  X,
  Loader2,
  SlidersHorizontal,
  History,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Department, Vendor, Issue, StockCount } from '../types';
import {
  calculateStockValue,
  calculateAverageDailyConsumption,
  calculateStockDays,
  calculateExcessStock,
} from '../services/calculations';
import { exportToCsv, exportToPdf } from '../services/exportService';
import {
  deleteInventoryItemSafely,
  bulkDeleteInventoryItemsSafely,
  BulkItemDeleteResult,
} from '../services/restaurantService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import {
  EditStockModal,
  StockAdjustmentSuccessPayload,
} from '../components/inventory/EditStockModal';
import {
  formatSignedStockDifference,
  formatStockQuantity,
} from '../utils/stockAdjustment';
import {
  UNIT_OF_MEASURE_OPTIONS,
  isSupportedUnit,
  normalizeImportedUnit,
} from '../utils/units';

interface DeleteFeedbackNotice {
  variant: 'success' | 'warning' | 'error';
  title: string;
  details: string[];
  deletedCount?: number;
  archivedCount?: number;
  failedCount?: number;
}

export const StockView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, activeRole, hasRole } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  // RBAC: Owner & Manager follow inventory management permissions; Storekeeper & Dept Staff cannot delete
  const canManageInventory = hasRole(['OWNER', 'MANAGER']);
  // RBAC: Owner, Manager, and Storekeeper can perform auditable stock quantity adjustments (matches Firestore rules)
  const canAdjustStock = hasRole(['OWNER', 'MANAGER', 'STOREKEEPER']);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'LOW' | 'EXCESS' | 'SUFFICIENT'>('ALL');
  const [showArchived, setShowArchived] = useState(false);

  // Add / Edit Modal
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // Edit Current Stock Modal & Adjustment History
  const [adjustingStockItemId, setAdjustingStockItemId] = useState<string | null>(null);
  const [stockAdjustments, setStockAdjustments] = useState<StockCount[]>([]);
  const [adjustmentHistorySearch, setAdjustmentHistorySearch] = useState('');

  // View Item Modal
  const [viewingItem, setViewingItem] = useState<(Item & { stockValue: number; stockDaysLabel: string; statusType: string }) | null>(null);

  // Action Menu Popover (fixed positioning avoids overflow-hidden/overflow-x-auto clipping)
  const [openMenu, setOpenMenu] = useState<{ itemId: string; top: number; right: number; openUp: boolean } | null>(null);

  // Selection & Bulk Delete State
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const selectAllDesktopRef = useRef<HTMLInputElement | null>(null);
  const selectAllMobileRef = useRef<HTMLInputElement | null>(null);

  // Single Delete Confirmation State
  const [itemPendingDelete, setItemPendingDelete] = useState<Item | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);

  // Bulk Delete Confirmation State
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // Result Feedback Banner
  const [deleteNotice, setDeleteNotice] = useState<DeleteFeedbackNotice | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [unit, setUnit] = useState('Kg');
  const [departmentId, setDepartmentId] = useState('');
  const [primaryVendorId, setPrimaryVendorId] = useState('');
  const [currentItemRateInput, setCurrentItemRateInput] = useState<string>('0');
  const [itemFormError, setItemFormError] = useState<string | null>(null);
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

  const getEffectiveCurrentRate = (item: Item): number => {
    if (
      item.currentItemRate !== undefined &&
      item.currentItemRate !== null &&
      !Number.isNaN(Number(item.currentItemRate))
    ) {
      return Math.max(0, Number(item.currentItemRate));
    }
    return Math.max(0, Number(item.lastPurchaseRate || item.averageStockRate || 0));
  };

  // Reset selection and notice when switching restaurants
  useEffect(() => {
    setSelectedItemIds(new Set());
    setOpenMenu(null);
    setDeleteNotice(null);
    setSaveSuccessNotice(null);
    setAdjustingStockItemId(null);
    setAdjustmentHistorySearch('');
  }, [activeRestaurantId]);

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

    let unsubStockCounts: (() => void) | undefined;
    if (canAdjustStock) {
      unsubStockCounts = onSnapshot(
        query(
          collection(db, 'restaurants', activeRestaurantId, 'stockCounts'),
          orderBy('createdAt', 'desc'),
          limit(50)
        ),
        (snap) => {
          setStockAdjustments(snap.docs.map((d) => d.data() as StockCount));
        }
      );
    } else {
      setStockAdjustments([]);
    }

    return () => {
      unsubItems();
      unsubDepts();
      unsubVendors();
      unsubIssues();
      if (unsubStockCounts) unsubStockCounts();
    };
  }, [activeRestaurantId, canAdjustStock]);

  const liveAdjustingItem = useMemo(
    () => (adjustingStockItemId ? items.find((i) => i.id === adjustingStockItemId) || null : null),
    [adjustingStockItemId, items]
  );

  const filteredStockAdjustments = useMemo(() => {
    const q = adjustmentHistorySearch.trim().toLowerCase();
    if (!q) return stockAdjustments;
    return stockAdjustments.filter(
      (adj) =>
        (adj.itemName || '').toLowerCase().includes(q) ||
        (adj.reason || '').toLowerCase().includes(q) ||
        (adj.countedByName || '').toLowerCase().includes(q) ||
        (adj.unit || '').toLowerCase().includes(q)
    );
  }, [stockAdjustments, adjustmentHistorySearch]);

  const handleOpenEditStock = (item: Item) => {
    if (!canAdjustStock || item.status === 'inactive') return;
    setOpenMenu(null);
    setAdjustingStockItemId(item.id);
  };

  const handleStockAdjustmentSuccess = (result: StockAdjustmentSuccessPayload) => {
    const signedDiff = formatSignedStockDifference(result.difference);
    setSaveSuccessNotice(
      `Stock updated for ${result.itemName}: ${formatStockQuantity(result.previousStock)} ${result.unit} → ${formatStockQuantity(result.newStock)} ${result.unit} (${signedDiff} ${result.unit}). Reason: ${result.reason}`
    );
    window.setTimeout(() => {
      setSaveSuccessNotice((prev) =>
        prev && prev.includes(result.itemName) ? null : prev
      );
    }, 7000);
  };

  // Close action dropdown on outside click, escape, or scroll
  useEffect(() => {
    if (!openMenu) return;
    const handleClose = () => setOpenMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const activeItemsCount = useMemo(
    () => items.filter((i) => i.status !== 'inactive').length,
    [items]
  );

  const archivedItemsCount = useMemo(
    () => items.filter((i) => i.status === 'inactive').length,
    [items]
  );

  // Filtered List with Metrics
  const processedItems = useMemo(() => {
    return items.map((item) => {
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
  }, [items, issues]);

  const filteredItems = useMemo(() => {
    return processedItems.filter((item) => {
      const isArchived = item.status === 'inactive';
      if (!showArchived && isArchived) return false;
      const matchSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = selectedDept === 'ALL' || item.departmentId === selectedDept;
      const matchStatus = selectedStatus === 'ALL' || item.statusType === selectedStatus;
      return matchSearch && matchDept && matchStatus;
    });
  }, [processedItems, showArchived, searchQuery, selectedDept, selectedStatus]);

  // Selectable items are active (non-archived) visible items
  const selectableVisibleItems = useMemo(
    () => filteredItems.filter((i) => i.status !== 'inactive'),
    [filteredItems]
  );

  const selectedVisibleCount = useMemo(
    () => selectableVisibleItems.filter((i) => selectedItemIds.has(i.id)).length,
    [selectableVisibleItems, selectedItemIds]
  );

  const allVisibleSelected =
    selectableVisibleItems.length > 0 && selectedVisibleCount === selectableVisibleItems.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleItems.length;

  useEffect(() => {
    if (selectAllDesktopRef.current) {
      selectAllDesktopRef.current.indeterminate = someVisibleSelected;
    }
    if (selectAllMobileRef.current) {
      selectAllMobileRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  // Prune any selected IDs that are no longer active
  useEffect(() => {
    const activeIds = new Set(items.filter((i) => i.status !== 'inactive').map((i) => i.id));
    setSelectedItemIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (activeIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

  const selectedItemsList = useMemo(
    () => items.filter((i) => selectedItemIds.has(i.id) && i.status !== 'inactive'),
    [items, selectedItemIds]
  );

  const toggleSelectOne = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        selectableVisibleItems.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        selectableVisibleItems.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const clearSelection = () => {
    setSelectedItemIds(new Set());
  };

  const handleOpenActionMenu = (e: React.MouseEvent<HTMLButtonElement>, itemId: string) => {
    e.stopPropagation();
    if (openMenu?.itemId === itemId) {
      setOpenMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 160;
    setOpenMenu({
      itemId,
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      right: Math.max(12, window.innerWidth - rect.right),
      openUp,
    });
  };

  const openAddModal = () => {
    setEditingItem(null);
    setName('');
    setCategory('Grocery');
    setUnit('Kg');
    setDepartmentId(departments[0]?.id || '');
    setPrimaryVendorId(vendors[0]?.id || '');
    setCurrentItemRateInput('0');
    setItemFormError(null);
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
    setCurrentItemRateInput(getEffectiveCurrentRate(item).toFixed(2));
    setItemFormError(null);
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
    setItemFormError(null);

    const deptObj = departments.find((d) => d.id === departmentId);
    const vendorObj = vendors.find((v) => v.id === primaryVendorId);
    const now = new Date().toISOString();

    if (editingItem) {
      if (!canManageInventory) {
        setItemFormError('Permission denied: Only Owner or authorized Manager can edit item master details and rates.');
        return;
      }

      const trimmedRate = String(currentItemRateInput).trim();
      const parsedRate = trimmedRate === '' ? NaN : Number(trimmedRate);
      if (!Number.isFinite(parsedRate) || parsedRate < 0) {
        setItemFormError('Please enter a valid Current Item Rate (0 or greater). Negative values are not allowed.');
        return;
      }

      const roundedCurrentRate = Number(parsedRate.toFixed(2));

      try {
        const itemRef = doc(db, 'restaurants', activeRestaurantId, 'items', editingItem.id);
        // Save updated item master fields and currentItemRate ONLY (never directly alter WAC averageStockRate, lastPurchaseRate, or currentStock)
        await updateDoc(itemRef, {
          name: name.trim(),
          category,
          unit,
          departmentId: departmentId || '',
          departmentName: deptObj?.name || '',
          primaryVendorId: primaryVendorId || '',
          primaryVendorName: vendorObj?.name || '',
          currentItemRate: roundedCurrentRate,
          minimumStock: Number(minimumStock),
          maximumStock: Number(maximumStock),
          targetStockDays: Number(targetStockDays),
          taxPercent: Number(taxPercent),
          updatedAt: now,
        });

        setSaveSuccessNotice(
          `Saved changes for "${name.trim()}". Current Item Rate updated to ${currencySymbol}${roundedCurrentRate.toFixed(2)} / ${unit}.`
        );
        setIsItemModalOpen(false);
      } catch (err: any) {
        setItemFormError(err?.message || 'Unable to save item changes. Please check your permissions and try again.');
      }
    } else {
      const parsedOpeningRate = Number(openingRate);
      if (!Number.isFinite(parsedOpeningRate) || parsedOpeningRate < 0) {
        setItemFormError('Opening rate cannot be negative.');
        return;
      }
      const roundedOpeningRate = Number(parsedOpeningRate.toFixed(2));

      try {
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
          currentItemRate: roundedOpeningRate,
          lastPurchaseRate: roundedOpeningRate,
          averageStockRate: roundedOpeningRate,
          taxPercent: Number(taxPercent),
          reorderLevel: Number(minimumStock),
          status: 'active',
          restaurantId: activeRestaurantId,
          updatedAt: now,
        };
        await setDoc(itemRef, newItem);
        setSaveSuccessNotice(`Created item "${name.trim()}" (${currencySymbol}${roundedOpeningRate.toFixed(2)} / ${unit}).`);
        setIsItemModalOpen(false);
      } catch (err: any) {
        setItemFormError(err?.message || 'Unable to create item. Please try again.');
      }
    }
  };

  // Individual Item Delete Handler
  const handleConfirmSingleDelete = async () => {
    if (!activeRestaurantId || !itemPendingDelete || !canManageInventory) return;
    setIsDeletingSingle(true);
    try {
      const res = await deleteInventoryItemSafely({
        restaurantId: activeRestaurantId,
        item: itemPendingDelete,
        actorUid: user?.uid || 'system',
        actorName: userProfile?.name || user?.displayName || 'Authorized User',
        actorRole: activeRole,
      });

      // Clear deleted/archived item from selection
      if (res.outcome === 'DELETED' || res.outcome === 'ARCHIVED') {
        setSelectedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(res.itemId);
          return next;
        });
      }

      if (res.outcome === 'DELETED') {
        setDeleteNotice({
          variant: 'success',
          title: `Deleted "${res.itemName}"`,
          details: ['Item had zero stock and no historical transactions, so it was permanently removed.'],
          deletedCount: 1,
          archivedCount: 0,
          failedCount: 0,
        });
      } else if (res.outcome === 'ARCHIVED') {
        setDeleteNotice({
          variant: 'warning',
          title: `Archived "${res.itemName}" (Historical Records Preserved)`,
          details: [
            `Safely deactivated instead of permanently deleting because it is linked to: ${res.reasons.join(', ')}.`,
            'All past transactions, purchase orders, and reports remain intact.',
          ],
          deletedCount: 0,
          archivedCount: 1,
          failedCount: 0,
        });
      } else {
        setDeleteNotice({
          variant: 'error',
          title: `Could not delete "${res.itemName}"`,
          details: [res.error || 'Deletion failed due to permissions or network error.'],
          deletedCount: 0,
          archivedCount: 0,
          failedCount: 1,
        });
      }

      setItemPendingDelete(null);
    } catch (err: any) {
      setDeleteNotice({
        variant: 'error',
        title: `Failed to delete "${itemPendingDelete.name}"`,
        details: [err?.message || 'Unexpected error during deletion.'],
        deletedCount: 0,
        archivedCount: 0,
        failedCount: 1,
      });
      setItemPendingDelete(null);
    } finally {
      setIsDeletingSingle(false);
    }
  };

  // Bulk Item Delete Handler
  const handleConfirmBulkDelete = async () => {
    if (!activeRestaurantId || selectedItemsList.length === 0 || !canManageInventory) return;
    setIsDeletingBulk(true);
    try {
      const bulkRes: BulkItemDeleteResult = await bulkDeleteInventoryItemsSafely({
        restaurantId: activeRestaurantId,
        itemsToDelete: selectedItemsList,
        actorUid: user?.uid || 'system',
        actorName: userProfile?.name || user?.displayName || 'Authorized User',
        actorRole: activeRole,
      });

      const processedSuccessIds = new Set([
        ...bulkRes.deleted.map((d) => d.itemId),
        ...bulkRes.archived.map((a) => a.itemId),
      ]);

      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        processedSuccessIds.forEach((id) => next.delete(id));
        return next;
      });

      const details: string[] = [];
      if (bulkRes.deleted.length > 0) {
        details.push(
          `Successfully deleted (${bulkRes.deleted.length}): ${bulkRes.deleted.map((d) => d.itemName).join(', ')}`
        );
      }
      if (bulkRes.archived.length > 0) {
        details.push(
          `Archived to preserve history (${bulkRes.archived.length}): ${bulkRes.archived
            .map((a) => `${a.itemName} (${a.reasons[0] || 'linked history'})`)
            .join(', ')}`
        );
      }
      if (bulkRes.failed.length > 0) {
        details.push(
          `Failed (${bulkRes.failed.length}): ${bulkRes.failed
            .map((f) => `${f.itemName}: ${f.error || 'Error'}`)
            .join('; ')}`
        );
      }

      const hasSuccess = bulkRes.deleted.length > 0 || bulkRes.archived.length > 0;
      const variant: DeleteFeedbackNotice['variant'] =
        bulkRes.failed.length > 0 && !hasSuccess
          ? 'error'
          : bulkRes.failed.length > 0 || bulkRes.archived.length > 0
          ? 'warning'
          : 'success';

      setDeleteNotice({
        variant,
        title:
          bulkRes.failed.length > 0 && !hasSuccess
            ? 'Bulk Delete Failed'
            : 'Bulk Inventory Cleanup Complete',
        details,
        deletedCount: bulkRes.deleted.length,
        archivedCount: bulkRes.archived.length,
        failedCount: bulkRes.failed.length,
      });

      setIsBulkDeleteModalOpen(false);
    } catch (err: any) {
      setDeleteNotice({
        variant: 'error',
        title: 'Bulk Delete Failed',
        details: [err?.message || 'Unexpected error during bulk deletion.'],
        deletedCount: 0,
        archivedCount: 0,
        failedCount: selectedItemsList.length,
      });
      setIsBulkDeleteModalOpen(false);
    } finally {
      setIsDeletingBulk(false);
    }
  };

  // CSV Bulk Import
  const handleCsvImport = async () => {
    if (!activeRestaurantId || !csvText.trim()) return;
    try {
      setImportStatus('Importing items to Firestore...');
      const lines = csvText.trim().split('\n');
      const batch = writeBatch(db);
      let count = 0;

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
            unit: normalizeImportedUnit(itemUnit),
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
      i.status === 'inactive' ? 'ARCHIVED' : i.statusType,
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

  const openMenuItem = openMenu ? filteredItems.find((i) => i.id === openMenu.itemId) || null : null;

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Current Stock Inventory</h1>
            <Badge variant="neutral" size="sm">
              {activeItemsCount} Active SKUs
            </Badge>
            {archivedItemsCount > 0 && (
              <Badge variant="neutral" size="sm">
                {archivedItemsCount} Archived
              </Badge>
            )}
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

      {/* Item Save Success Notification Banner */}
      {saveSuccessNotice && (
        <div
          id="item-save-success-banner"
          className="rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 p-3.5 flex items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{saveSuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessNotice(null)}
            className="p-1 rounded hover:bg-emerald-100/70 text-emerald-800 shrink-0"
            aria-label="Dismiss save notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Delete / Archive Feedback Notification Banner */}
      {deleteNotice && (
        <div
          id="inventory-delete-feedback-banner"
          className={`rounded-xl border p-4 flex items-start justify-between gap-3 text-xs ${
            deleteNotice.variant === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : deleteNotice.variant === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-950'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {deleteNotice.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : deleteNotice.variant === 'warning' ? (
              <Archive className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-bold">{deleteNotice.title}</p>
              {(deleteNotice.deletedCount !== undefined ||
                deleteNotice.archivedCount !== undefined ||
                deleteNotice.failedCount !== undefined) && (
                <div className="flex flex-wrap gap-2 pt-0.5 pb-0.5 text-[11px] font-semibold">
                  <span className="px-2 py-0.5 rounded bg-white/80 border border-emerald-200 text-emerald-800">
                    Successfully deleted: {deleteNotice.deletedCount ?? 0}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white/80 border border-amber-200 text-amber-800">
                    Archived: {deleteNotice.archivedCount ?? 0}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white/80 border border-rose-200 text-rose-800">
                    Failed: {deleteNotice.failedCount ?? 0}
                  </span>
                </div>
              )}
              {deleteNotice.details.map((line, idx) => (
                <p key={idx} className="opacity-90 leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDeleteNotice(null)}
            className="p-1 rounded hover:bg-black/5 shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
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

          {archivedItemsCount > 0 && (
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-stone-200 rounded-lg bg-stone-50 text-stone-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
              <span>Show Archived ({archivedItemsCount})</span>
            </label>
          )}
        </div>
      </div>

      {/* Bulk Action Toolbar (Shown when 1+ items selected by authorized Owner/Manager) */}
      {canManageInventory && selectedItemsList.length > 0 && (
        <div
          id="bulk-action-toolbar"
          className="bg-stone-900 text-white rounded-xl border border-stone-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
        >
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-[#FF5A1F] text-white font-bold text-xs">
              {selectedItemsList.length}
            </span>
            <span className="text-xs sm:text-sm font-semibold">
              {selectedItemsList.length} {selectedItemsList.length === 1 ? 'Item' : 'Items'} Selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="bulk-cancel-selection-btn"
              type="button"
              onClick={clearSelection}
              className="px-3 py-1.5 rounded-lg border border-stone-700 hover:bg-stone-800 text-stone-200 text-xs font-semibold transition-colors"
            >
              Cancel Selection
            </button>
            <button
              id="bulk-delete-selected-btn"
              type="button"
              onClick={() => setIsBulkDeleteModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected</span>
            </button>
          </div>
        </div>
      )}

      {/* Items List — Desktop / Tablet Table */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                {canManageInventory && (
                  <th className="py-3 pl-4 pr-2 w-10">
                    <input
                      ref={selectAllDesktopRef}
                      id="select-all-items-checkbox"
                      type="checkbox"
                      aria-label="Select all visible inventory items"
                      checked={allVisibleSelected}
                      disabled={selectableVisibleItems.length === 0}
                      onChange={toggleSelectAllVisible}
                      className="w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 cursor-pointer disabled:opacity-40"
                    />
                  </th>
                )}
                <th className="py-3 px-4">Item Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4 text-right">Current Stock</th>
                <th className="py-3 px-4 text-right">Avg Rate</th>
                <th className="py-3 px-4 text-right">Stock Value</th>
                <th className="py-3 px-4">Stock Days</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={canManageInventory ? 10 : 9} className="py-10 text-center text-stone-400">
                    Loading stock ledger...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={canManageInventory ? 10 : 9} className="py-12 text-center text-stone-400">
                    No items matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isArchived = item.status === 'inactive';
                  const isSelected = selectedItemIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-stone-50/60 transition-colors ${
                        isSelected ? 'bg-amber-50/40' : ''
                      } ${isArchived ? 'opacity-65 bg-stone-50/50' : ''}`}
                    >
                      {canManageInventory && (
                        <td className="py-3 pl-4 pr-2">
                          <input
                            id={`select-item-${item.id}`}
                            type="checkbox"
                            aria-label={`Select ${item.name}`}
                            checked={isSelected}
                            disabled={isArchived}
                            onChange={() => toggleSelectOne(item.id)}
                            className="w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 cursor-pointer disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="py-3 px-4 font-semibold text-stone-900">
                        <div className="flex items-center gap-2">
                          <span>{item.name}</span>
                          {isArchived && (
                            <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-700 text-[10px] font-semibold">
                              Archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-medium">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-stone-500">{item.departmentName || 'General Store'}</td>
                      <td className="py-3 px-4 text-right font-bold text-stone-900">
                        {item.currentStock}{' '}
                        <span className="text-[11px] font-normal text-stone-500">{item.unit}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-stone-700">
                        {currencySymbol}
                        {(item.averageStockRate || item.lastPurchaseRate || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-stone-900">
                        {currencySymbol}
                        {item.stockValue.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-stone-500 font-mono text-[11px]">
                        {item.stockDaysLabel}
                      </td>
                      <td className="py-3 px-4">
                        {isArchived ? (
                          <Badge variant="neutral" size="sm">
                            Archived
                          </Badge>
                        ) : item.statusType === 'LOW' ? (
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
                      <td className="py-3 px-4 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          {canAdjustStock && !isArchived && (
                            <button
                              id={`quick-edit-stock-btn-${item.id}`}
                              type="button"
                              onClick={() => handleOpenEditStock(item)}
                              title={`Edit current stock for ${item.name}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#0D2149]/20 bg-[#0D2149]/5 hover:bg-[#0D2149] text-[#0D2149] hover:text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>Edit Stock</span>
                            </button>
                          )}
                          <button
                            id={`item-action-menu-btn-${item.id}`}
                            type="button"
                            aria-label={`Actions for ${item.name}`}
                            onClick={(e) => handleOpenActionMenu(e, item.id)}
                            className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Items List — Mobile Responsive Cards */}
      <div className="md:hidden space-y-3">
        {canManageInventory && selectableVisibleItems.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-2.5 flex items-center justify-between">
            <label className="flex items-center gap-2.5 text-xs font-bold text-stone-800 cursor-pointer">
              <input
                ref={selectAllMobileRef}
                id="mobile-select-all-items-checkbox"
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
              />
              <span>Select All ({selectableVisibleItems.length})</span>
            </label>
            {selectedItemsList.length > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="text-[11px] font-semibold text-stone-500 hover:text-stone-800"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-xs text-stone-400">
            Loading stock ledger...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-xs text-stone-400">
            No items matching the selected filters.
          </div>
        ) : (
          filteredItems.map((item) => {
            const isArchived = item.status === 'inactive';
            const isSelected = selectedItemIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border p-4 space-y-3 shadow-2xs transition-colors ${
                  isSelected ? 'border-amber-400 bg-amber-50/30' : 'border-stone-200'
                } ${isArchived ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {canManageInventory && (
                      <input
                        id={`mobile-select-item-${item.id}`}
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={isSelected}
                        disabled={isArchived}
                        onChange={() => toggleSelectOne(item.id)}
                        className="mt-0.5 w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-bold text-stone-900 truncate">{item.name}</h3>
                        {isArchived && (
                          <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-700 text-[10px] font-semibold">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-medium">
                          {item.category}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {item.departmentName || 'General Store'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    id={`mobile-item-action-menu-btn-${item.id}`}
                    type="button"
                    aria-label={`Actions for ${item.name}`}
                    onClick={(e) => handleOpenActionMenu(e, item.id)}
                    className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg shrink-0"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-xs">
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase block">Stock</span>
                    <span className="font-bold text-stone-900">
                      {item.currentStock} {item.unit}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase block">Avg Rate</span>
                    <span className="font-semibold text-stone-700">
                      {currencySymbol}
                      {(item.averageStockRate || item.lastPurchaseRate || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-stone-400 uppercase block">Value</span>
                    <span className="font-bold text-stone-900">
                      {currencySymbol}
                      {item.stockValue.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] font-mono text-stone-500">
                    Days: {item.stockDaysLabel}
                  </span>
                  <div className="flex items-center gap-2">
                    {canAdjustStock && !isArchived && (
                      <button
                        id={`mobile-quick-edit-stock-btn-${item.id}`}
                        type="button"
                        onClick={() => handleOpenEditStock(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#0D2149]/20 bg-[#0D2149]/5 hover:bg-[#0D2149] text-[#0D2149] hover:text-white text-[11px] font-semibold transition-colors"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>Edit Stock</span>
                      </button>
                    )}
                    {isArchived ? (
                      <Badge variant="neutral" size="sm">
                        Archived
                      </Badge>
                    ) : item.statusType === 'LOW' ? (
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
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Stock Adjustment History (Visible to authorized users: Owner, Manager, Storekeeper) */}
      {canAdjustStock && (
        <section
          id="stock-adjustment-history-section"
          className="bg-white rounded-xl border border-stone-200 shadow-2xs overflow-hidden"
        >
          <div className="p-4 sm:p-5 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-stone-50/50">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-lg bg-[#0D2149] text-white shrink-0">
                <History className="w-4 h-4 text-[#FF5A1F]" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-[#0D2149]">Stock Adjustment History</h2>
                  <span className="px-2 py-0.5 rounded-md bg-stone-200/80 text-stone-700 text-[10px] font-bold">
                    {filteredStockAdjustments.length} {filteredStockAdjustments.length === 1 ? 'record' : 'records'}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Immutable audit log of manual stock corrections and physical counts. Valuation rates and vendor payables are unaffected.
                </p>
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
              <input
                id="stock-adjustment-history-search"
                type="text"
                placeholder="Search item, reason, or user..."
                value={adjustmentHistorySearch}
                onChange={(e) => setAdjustmentHistorySearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-[#0D2149]"
              />
            </div>
          </div>

          {filteredStockAdjustments.length === 0 ? (
            <div className="p-8 text-center text-xs text-stone-400">
              {stockAdjustments.length === 0
                ? 'No stock adjustments recorded yet. Use "Edit Stock" on any inventory item to record a manual correction.'
                : 'No stock adjustments match your search filter.'}
            </div>
          ) : (
            <>
              {/* Desktop History Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50/70 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4">Date &amp; Time</th>
                      <th className="py-2.5 px-4">Item</th>
                      <th className="py-2.5 px-4 text-right">Previous</th>
                      <th className="py-2.5 px-4 text-right">New Stock</th>
                      <th className="py-2.5 px-4 text-right">Difference</th>
                      <th className="py-2.5 px-4">Reason</th>
                      <th className="py-2.5 px-4">Adjusted By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-xs">
                    {filteredStockAdjustments.map((adj) => {
                      const isInc = adj.varianceQuantity > 0;
                      const isDec = adj.varianceQuantity < 0;
                      return (
                        <tr key={adj.id} className="hover:bg-stone-50/60 transition-colors">
                          <td className="py-3 px-4 text-stone-500 whitespace-nowrap font-mono text-[11px]">
                            {new Date(adj.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 font-semibold text-stone-900">
                            {adj.itemName}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-stone-600 whitespace-nowrap">
                            {formatStockQuantity(adj.systemStock)} {adj.unit}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-stone-900 whitespace-nowrap">
                            {formatStockQuantity(adj.physicalStock)} {adj.unit}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                                isInc
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : isDec
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-stone-100 text-stone-600 border border-stone-200'
                              }`}
                            >
                              {formatSignedStockDifference(adj.varianceQuantity)} {adj.unit}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-stone-700 max-w-xs">
                            <span className="line-clamp-2" title={adj.reason}>
                              {adj.reason}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-stone-600 whitespace-nowrap">
                            <div className="font-medium text-stone-800">{adj.countedByName}</div>
                            {adj.actorRole && (
                              <span className="text-[10px] uppercase tracking-wide text-stone-400">
                                {adj.actorRole.replace('_', ' ')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile History Cards */}
              <div className="md:hidden divide-y divide-stone-100">
                {filteredStockAdjustments.map((adj) => {
                  const isInc = adj.varianceQuantity > 0;
                  const isDec = adj.varianceQuantity < 0;
                  return (
                    <div key={adj.id} className="p-4 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-stone-900 truncate">{adj.itemName}</p>
                          <p className="text-[10px] font-mono text-stone-400 mt-0.5">
                            {new Date(adj.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] shrink-0 ${
                            isInc
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : isDec
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                          }`}
                        >
                          {formatSignedStockDifference(adj.varianceQuantity)} {adj.unit}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-stone-50 border border-stone-100">
                        <div>
                          <span className="text-[10px] uppercase text-stone-400 block">Previous</span>
                          <span className="font-mono font-semibold text-stone-700">
                            {formatStockQuantity(adj.systemStock)} {adj.unit}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] uppercase text-stone-400 block">New Stock</span>
                          <span className="font-mono font-bold text-stone-900">
                            {formatStockQuantity(adj.physicalStock)} {adj.unit}
                          </span>
                        </div>
                      </div>

                      <p className="text-stone-700 leading-relaxed">
                        <span className="font-semibold text-stone-500">Reason: </span>
                        {adj.reason}
                      </p>
                      <p className="text-[11px] text-stone-500">
                        By <span className="font-semibold text-stone-700">{adj.countedByName}</span>
                        {adj.actorRole ? ` (${adj.actorRole.replace('_', ' ')})` : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {/* Fixed Floating Row Action Menu (View Item / Edit Item / Delete Item) */}
      {openMenu && openMenuItem && (
        <div
          id="item-row-action-menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: openMenu.openUp ? 'auto' : `${openMenu.top}px`,
            bottom: openMenu.openUp ? `${window.innerHeight - openMenu.top}px` : 'auto',
            right: `${openMenu.right}px`,
          }}
          className="z-50 w-44 bg-white rounded-xl shadow-xl border border-stone-200 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            id={`action-view-item-${openMenuItem.id}`}
            type="button"
            onClick={() => {
              setViewingItem(openMenuItem);
              setOpenMenu(null);
            }}
            className="w-full text-left px-3 py-2 text-stone-700 hover:bg-stone-50 flex items-center gap-2 font-medium"
          >
            <Eye className="w-3.5 h-3.5 text-stone-500" />
            <span>View Item</span>
          </button>

          {canAdjustStock && openMenuItem.status !== 'inactive' && (
            <button
              id={`action-edit-stock-${openMenuItem.id}`}
              type="button"
              onClick={() => handleOpenEditStock(openMenuItem)}
              className="w-full text-left px-3 py-2 text-[#0D2149] hover:bg-slate-50 flex items-center gap-2 font-semibold"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF5A1F]" />
              <span>Edit Stock</span>
            </button>
          )}

          {canManageInventory && (
            <>
              <button
                id={`action-edit-item-${openMenuItem.id}`}
                type="button"
                onClick={() => {
                  openEditModal(openMenuItem);
                  setOpenMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-stone-700 hover:bg-stone-50 flex items-center gap-2 font-medium"
              >
                <Edit2 className="w-3.5 h-3.5 text-stone-500" />
                <span>Edit Item</span>
              </button>

              {openMenuItem.status !== 'inactive' && (
                <>
                  <div className="my-1 border-t border-stone-100" />
                  <button
                    id={`action-delete-item-${openMenuItem.id}`}
                    type="button"
                    onClick={() => {
                      setItemPendingDelete(openMenuItem);
                      setOpenMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Delete Item</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* View Item Details Modal */}
      <Modal
        isOpen={Boolean(viewingItem)}
        onClose={() => setViewingItem(null)}
        title={viewingItem?.name || 'Item Details'}
        subtitle="Inventory Master Specification"
        maxWidth="md"
      >
        {viewingItem && (() => {
          const liveViewingItem = processedItems.find((i) => i.id === viewingItem.id) || viewingItem;
          const effectiveRate = getEffectiveCurrentRate(liveViewingItem);
          const hasPreviousPurchaseRate = Number(liveViewingItem.lastPurchaseRate) > 0;
          return (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-stone-50 border border-stone-200">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Item Name</span>
                  <p className="font-bold text-stone-900 mt-0.5">{liveViewingItem.name}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Category</span>
                  <p className="font-semibold text-stone-800 mt-0.5">{liveViewingItem.category}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Department</span>
                  <p className="text-stone-700 mt-0.5">{liveViewingItem.departmentName || 'General Store'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Primary Vendor</span>
                  <p className="text-stone-700 mt-0.5">{liveViewingItem.primaryVendorName || 'Not assigned'}</p>
                </div>
                <div className="col-span-2 p-2.5 rounded-lg bg-white border border-stone-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-stone-500 block">
                      Current Item Rate ({currencySymbol})
                    </span>
                    <p className="text-sm font-bold text-stone-900 mt-0.5 font-mono">
                      {currencySymbol}
                      {effectiveRate.toFixed(2)} / {liveViewingItem.unit}
                    </p>
                  </div>
                  {hasPreviousPurchaseRate && (
                    <div className="text-right">
                      <span className="text-[11px] font-semibold text-stone-600 bg-stone-100 px-2.5 py-1 rounded-md border border-stone-200 inline-block">
                        Last Purchase Rate: {currencySymbol}
                        {Number(liveViewingItem.lastPurchaseRate).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Current Stock</span>
                  <p className="font-bold text-stone-900 mt-0.5">
                    {liveViewingItem.currentStock} {liveViewingItem.unit}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Avg Rate (WAC)</span>
                  <p className="font-semibold text-stone-800 mt-0.5">
                    {currencySymbol}
                    {(liveViewingItem.averageStockRate || liveViewingItem.lastPurchaseRate || 0).toFixed(2)} / {liveViewingItem.unit}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Stock Value</span>
                  <p className="font-bold text-stone-900 mt-0.5">
                    {currencySymbol}
                    {liveViewingItem.stockValue.toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-stone-400 block">Min / Max / Target Days</span>
                  <p className="text-stone-700 mt-0.5">
                    {liveViewingItem.minimumStock} / {liveViewingItem.maximumStock} {liveViewingItem.unit} • {liveViewingItem.targetStockDays}d
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {canAdjustStock && liveViewingItem.status !== 'inactive' && (
                  <button
                    id="view-modal-edit-stock-btn"
                    type="button"
                    onClick={() => {
                      const target = liveViewingItem;
                      setViewingItem(null);
                      handleOpenEditStock(target);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#e24c16] text-white font-bold shadow-xs transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Edit Stock</span>
                  </button>
                )}
                {canManageInventory && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = liveViewingItem;
                      setViewingItem(null);
                      openEditModal(target);
                    }}
                    className="px-4 py-2 border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-lg font-semibold"
                  >
                    Edit Item
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Individual Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(itemPendingDelete)}
        onClose={() => !isDeletingSingle && setItemPendingDelete(null)}
        title="Delete Inventory Item"
        subtitle="Are you sure you want to delete this inventory item?"
        maxWidth="md"
      >
        {itemPendingDelete && (
          <div className="space-y-4 text-xs">
            <p className="text-stone-700 font-medium">
              Are you sure you want to delete this inventory item?
            </p>

            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <div className="flex justify-between">
                <span className="text-stone-500">Item Name:</span>
                <span className="font-bold text-stone-900">{itemPendingDelete.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Category:</span>
                <span className="font-semibold text-stone-800">{itemPendingDelete.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Current Stock:</span>
                <span className="font-bold text-stone-900">{itemPendingDelete.currentStock}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Unit:</span>
                <span className="font-semibold text-stone-800">{itemPendingDelete.unit}</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
              Safety guarantee: If this item has active stock or historical transactions (Purchase Orders, Invoices, Issues, Audits, Wastage, or Recipes), it will be safely archived instead of permanently deleted so all reports remain intact.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                id="cancel-single-delete-btn"
                type="button"
                disabled={isDeletingSingle}
                onClick={() => setItemPendingDelete(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-700 font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                id="confirm-single-delete-btn"
                type="button"
                disabled={isDeletingSingle}
                onClick={handleConfirmSingleDelete}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xs disabled:opacity-50"
              >
                {isDeletingSingle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Delete Item</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => !isDeletingBulk && setIsBulkDeleteModalOpen(false)}
        title="Confirm Bulk Delete"
        subtitle={`${selectedItemsList.length} ${selectedItemsList.length === 1 ? 'item' : 'items'} selected for removal`}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-sm font-semibold text-stone-900">
            You are about to delete {selectedItemsList.length} inventory{' '}
            {selectedItemsList.length === 1 ? 'item' : 'items'}. Are you sure?
          </p>

          <div className="rounded-xl border border-stone-200 bg-stone-50 overflow-hidden">
            <div className="px-3.5 py-2 bg-stone-100 border-b border-stone-200 flex items-center justify-between text-[11px] font-bold text-stone-700 uppercase">
              <span>Selected Items ({selectedItemsList.length})</span>
              <span>Current Stock</span>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-stone-200/70">
              {selectedItemsList.map((item) => (
                <div key={item.id} className="px-3.5 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-stone-900 truncate">{item.name}</p>
                    <p className="text-[10px] text-stone-500">{item.category}</p>
                  </div>
                  <span className="font-mono font-semibold text-stone-800 shrink-0">
                    {item.currentStock} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
            Items with zero stock and zero transaction references will be permanently deleted. Items with stock or historical records will be safely archived to protect reports and ledgers.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
            <button
              id="cancel-bulk-delete-btn"
              type="button"
              disabled={isDeletingBulk}
              onClick={() => setIsBulkDeleteModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-700 font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="confirm-bulk-delete-btn"
              type="button"
              disabled={isDeletingBulk}
              onClick={handleConfirmBulkDelete}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xs disabled:opacity-50"
            >
              {isDeletingBulk ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Confirm Delete</span>
            </button>
          </div>
        </div>
      </Modal>

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
              <label
                htmlFor="item-unit-select"
                className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1"
              >
                Unit of Measure
              </label>
              <select
                id="item-unit-select"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                {UNIT_OF_MEASURE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                {unit && !isSupportedUnit(unit) && (
                  <option value={unit}>{unit}</option>
                )}
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

          {editingItem && (
            <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="current-item-rate-input"
                    className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1"
                  >
                    CURRENT ITEM RATE ({currencySymbol})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs font-bold text-stone-500 select-none">
                      {currencySymbol}
                    </span>
                    <input
                      id="current-item-rate-input"
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      disabled={!canManageInventory}
                      placeholder={`${currencySymbol}140.00`}
                      value={currentItemRateInput}
                      onChange={(e) => {
                        setCurrentItemRateInput(e.target.value);
                        if (itemFormError) setItemFormError(null);
                      }}
                      className="w-full pl-7 pr-12 py-2 text-xs font-mono font-bold text-stone-900 border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-amber-500 disabled:bg-stone-100 disabled:text-stone-500"
                    />
                    <span className="absolute right-3 top-2 text-[11px] text-stone-400 font-medium select-none">
                      / {unit}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:items-end justify-center gap-1 text-xs">
                  {Number(editingItem.lastPurchaseRate) > 0 && (
                    <span
                      id="edit-item-last-purchase-rate"
                      className="px-2.5 py-1 rounded-md bg-white border border-stone-200 font-semibold text-stone-700"
                    >
                      Last Purchase Rate: {currencySymbol}
                      {Number(editingItem.lastPurchaseRate).toFixed(2)}
                    </span>
                  )}
                  <span className="text-[11px] text-stone-500">
                    Current WAC: {currencySymbol}
                    {Number(editingItem.averageStockRate || 0).toFixed(2)} / {unit} (protected)
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Used as the default estimated rate for new Purchase Orders. Updating this rate does not modify existing stock valuation, Weighted Average Cost (WAC), or historical invoices.
              </p>
            </div>
          )}

          {itemFormError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{itemFormError}</span>
            </div>
          )}

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
                  Opening Stock Quantity ({unit})
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
      {/* Edit Current Stock Modal */}
      <EditStockModal
        isOpen={Boolean(liveAdjustingItem)}
        item={liveAdjustingItem}
        restaurantId={activeRestaurantId}
        actorUid={user?.uid || ''}
        actorName={userProfile?.name || user?.displayName || user?.email || 'Authorized User'}
        actorRole={activeRole}
        onClose={() => setAdjustingStockItemId(null)}
        onSuccess={handleStockAdjustmentSuccess}
      />
    </div>
  );
};
