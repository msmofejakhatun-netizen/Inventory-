import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Send,
  RefreshCw,
  Building2,
  Package,
  Phone,
  ArrowLeft,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Item, Vendor, PurchaseOrder, UserRole } from '../../types';
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  updateVendorContact,
} from '../../services/restaurantService';
import { sendPoViaWhatsAppApi } from '../../services/whatsappClient';

export interface SelectedPoDraftItem {
  item: Item;
  qtyInput: string; // Strictly empty string "" initially — manual entry only
}

export interface ResolvedVendorInfo {
  hasValidVendor: boolean;
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
}

export interface SupplierOrderGroup {
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  items: {
    item: Item;
    orderedQty: number;
    unit: string;
    estimatedRate: number;
    estimatedAmount: number;
  }[];
}

export type VendorDispatchStateStatus = 'IDLE' | 'SENDING' | 'SENT' | 'FAILED';

export interface VendorDispatchRecord {
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  items: SupplierOrderGroup['items'];
  createdPoId?: string;
  poNumber?: string;
  poObject?: PurchaseOrder;
  messageBody?: string;
  status: VendorDispatchStateStatus;
  whatsappMessageId?: string;
  errorMessage?: string;
}

interface SmartSupplierPoWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  restaurantName: string;
  currencySymbol: string;
  items: Item[];
  vendors: Vendor[];
  userUid: string;
  userName: string;
  userRole: UserRole | null;
  whatsAppConnected: boolean;
  onOrderSentOrUpdated?: () => void;
}

/**
 * Formats the strict no-price WhatsApp Purchase Order text message.
 * Contains ONLY ITEM NAME + QUANTITY + UNIT.
 * Strictly excludes rates, prices, amounts, totals, or currency values.
 */
export function formatSupplierWhatsAppOrderMessage(params: {
  restaurantName: string;
  poNumber: string;
  items: { itemName: string; orderedQty: number; unit: string }[];
}): string {
  const { restaurantName, poNumber, items } = params;
  const rows = items
    .map((it) => {
      const cleanName = (it.itemName || 'Item').trim();
      const paddedName = cleanName.length > 20 ? `${cleanName.slice(0, 19)} ` : cleanName.padEnd(20, ' ');
      const paddedQty = String(it.orderedQty).padEnd(9, ' ');
      const cleanUnit = (it.unit || '').trim();
      return `${paddedName} ${paddedQty} ${cleanUnit}`;
    })
    .join('\n');

  return `PURCHASE ORDER

Restaurant: ${restaurantName || 'STOQO Restaurant'}
PO No: ${poNumber}

ITEM                 QTY       UNIT

${rows}

Please confirm availability and delivery time.`;
}

export const SmartSupplierPoWorkspace: React.FC<SmartSupplierPoWorkspaceProps> = ({
  isOpen,
  onClose,
  restaurantId,
  restaurantName,
  items,
  vendors,
  userUid,
  userName,
  userRole,
  onOrderSentOrUpdated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedItems, setSelectedItems] = useState<SelectedPoDraftItem[]>([]);
  const [step, setStep] = useState<'BUILD' | 'PREVIEW' | 'DISPATCH'>('BUILD');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Expandable supplier groups in Preview & Dispatch steps
  const [expandedVendorIds, setExpandedVendorIds] = useState<Record<string, boolean>>({});

  // Per-vendor dispatch records (for creation, sending, status display, and non-duplicating retry)
  const [dispatchRecords, setDispatchRecords] = useState<Record<string, VendorDispatchRecord>>({});
  const [isDispatchingAll, setIsDispatchingAll] = useState(false);

  // Inline vendor phone quick-edit inside Preview / Dispatch
  const [editingVendorPhone, setEditingVendorPhone] = useState<Record<string, string>>({});
  const [savingVendorPhoneId, setSavingVendorPhoneId] = useState<string | null>(null);

  // Optional inline Primary Vendor assignment for items missing a Primary Vendor
  const [assigningVendorForItem, setAssigningVendorForItem] = useState<Record<string, string>>({});
  const [savingItemVendorId, setSavingItemVendorId] = useState<string | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Reset workspace state when opened
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setIsSearchFocused(false);
      setSelectedItems([]);
      setStep('BUILD');
      setValidationError(null);
      setExpandedVendorIds({});
      setDispatchRecords({});
      setIsDispatchingAll(false);
      setEditingVendorPhone({});
      setAssigningVendorForItem({});
    }
  }, [isOpen]);

  // Close autocomplete dropdown only when clicking outside the search box
  useEffect(() => {
    if (!isSearchFocused) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isSearchFocused]);

  // Active (non-archived) inventory items
  const activeInventoryItems = useMemo(
    () => items.filter((i) => i.status !== 'inactive'),
    [items]
  );

  // Resolve an item's assigned Primary Vendor from live Item Master + Vendors list
  const resolveItemVendor = (item: Item): ResolvedVendorInfo => {
    const rawVendorId = (item.primaryVendorId || '').trim();
    const rawVendorName = (item.primaryVendorName || '').trim();

    if (rawVendorId) {
      const byId = vendors.find((v) => v.id === rawVendorId);
      if (byId) {
        return {
          hasValidVendor: true,
          vendorId: byId.id,
          vendorName: byId.name,
          vendorPhone: byId.phone || byId.mobile || '',
        };
      }
    }

    if (rawVendorName) {
      const byName = vendors.find(
        (v) => v.name.trim().toLowerCase() === rawVendorName.toLowerCase()
      );
      if (byName) {
        return {
          hasValidVendor: true,
          vendorId: byName.id,
          vendorName: byName.name,
          vendorPhone: byName.phone || byName.mobile || '',
        };
      }
      if (rawVendorId) {
        return {
          hasValidVendor: true,
          vendorId: rawVendorId,
          vendorName: rawVendorName,
          vendorPhone: '',
        };
      }
    }

    return {
      hasValidVendor: false,
      vendorId: '',
      vendorName: '',
      vendorPhone: '',
    };
  };

  const getItemDefaultRate = (item: Item): number => {
    if (
      item.currentItemRate !== undefined &&
      item.currentItemRate !== null &&
      !Number.isNaN(Number(item.currentItemRate))
    ) {
      return Math.max(0, Number(item.currentItemRate));
    }
    return Math.max(0, Number(item.lastPurchaseRate || item.averageStockRate || 0));
  };

  // Keep selected items synced with live Firestore item updates (e.g. if primaryVendorId was just assigned)
  const syncedSelectedItems = useMemo(() => {
    return selectedItems.map((entry) => {
      const latestItem = items.find((i) => i.id === entry.item.id) || entry.item;
      return {
        ...entry,
        item: latestItem,
      };
    });
  }, [selectedItems, items]);

  const selectedItemIdsSet = useMemo(
    () => new Set(syncedSelectedItems.map((s) => s.item.id)),
    [syncedSelectedItems]
  );

  // Search autocomplete suggestions (matches by item name or category)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const pool = activeInventoryItems;
    if (!q) {
      return pool.slice(0, 25);
    }
    return pool
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [activeInventoryItems, searchQuery]);

  // Select an item from search results (prevents duplicates, sets quantity to EMPTY "")
  const handleSelectItemFromSearch = (item: Item) => {
    setValidationError(null);
    if (selectedItemIdsSet.has(item.id)) {
      // Already selected — focus its quantity input without duplicating
      setIsSearchFocused(false);
      setTimeout(() => {
        qtyInputRefs.current[item.id]?.focus();
      }, 40);
      return;
    }

    setSelectedItems((prev) => [
      ...prev,
      {
        item,
        qtyInput: '', // MUST initially be EMPTY — manual entry by user
      },
    ]);
    setSearchQuery('');
    setIsSearchFocused(false);

    // Focus the newly added item's manual quantity field
    setTimeout(() => {
      qtyInputRefs.current[item.id]?.focus();
    }, 60);
  };

  const handleQtyChange = (itemId: string, rawValue: string) => {
    if (validationError) setValidationError(null);
    setSelectedItems((prev) =>
      prev.map((entry) =>
        entry.item.id === itemId ? { ...entry, qtyInput: rawValue } : entry
      )
    );
  };

  const handleRemoveItem = (itemId: string) => {
    if (validationError) setValidationError(null);
    setSelectedItems((prev) => prev.filter((entry) => entry.item.id !== itemId));
  };

  // Optional inline fix if an item has no Primary Vendor assigned
  const handleAssignPrimaryVendorToItem = async (itemId: string) => {
    const chosenVendorId = assigningVendorForItem[itemId];
    if (!restaurantId || !chosenVendorId) return;
    const vendorObj = vendors.find((v) => v.id === chosenVendorId);
    if (!vendorObj) return;

    try {
      setSavingItemVendorId(itemId);
      const itemRef = doc(db, 'restaurants', restaurantId, 'items', itemId);
      await updateDoc(itemRef, {
        primaryVendorId: vendorObj.id,
        primaryVendorName: vendorObj.name,
        updatedAt: new Date().toISOString(),
      });
      setValidationError(null);
    } catch (err: any) {
      setValidationError(
        err?.message || 'Unable to assign Primary Vendor to this item.'
      );
    } finally {
      setSavingItemVendorId(null);
    }
  };

  // Identify items missing Primary Vendor
  const itemsMissingVendor = useMemo(() => {
    return syncedSelectedItems.filter(
      (entry) => !resolveItemVendor(entry.item).hasValidVendor
    );
  }, [syncedSelectedItems, vendors]);

  // Identify items with empty or invalid quantity
  const itemsWithInvalidQty = useMemo(() => {
    return syncedSelectedItems.filter((entry) => {
      const trimmed = entry.qtyInput.trim();
      if (!trimmed) return true;
      const n = Number(trimmed);
      return !Number.isFinite(n) || n <= 0;
    });
  }, [syncedSelectedItems]);

  // Automatic Supplier-Wise Grouping
  const supplierGroups = useMemo<SupplierOrderGroup[]>(() => {
    const groupMap = new Map<string, SupplierOrderGroup>();

    for (const entry of syncedSelectedItems) {
      const vInfo = resolveItemVendor(entry.item);
      if (!vInfo.hasValidVendor) continue;

      const parsedQty = Number(entry.qtyInput.trim());
      const validQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 0;
      const estRate = getItemDefaultRate(entry.item);
      const estAmount = Number((validQty * estRate).toFixed(2));

      if (!groupMap.has(vInfo.vendorId)) {
        groupMap.set(vInfo.vendorId, {
          vendorId: vInfo.vendorId,
          vendorName: vInfo.vendorName,
          vendorPhone: vInfo.vendorPhone,
          items: [],
        });
      }

      groupMap.get(vInfo.vendorId)!.items.push({
        item: entry.item,
        orderedQty: validQty,
        unit: entry.item.unit,
        estimatedRate: estRate,
        estimatedAmount: estAmount,
      });
    }

    return Array.from(groupMap.values());
  }, [syncedSelectedItems, vendors]);

  // Proceed from BUILD step to PREVIEW step after strict validation
  const handleProceedToPreview = () => {
    setValidationError(null);

    if (syncedSelectedItems.length === 0) {
      setValidationError('Please search and select at least one inventory item to order.');
      return;
    }

    if (itemsMissingVendor.length > 0) {
      const names = itemsMissingVendor.map((e) => e.item.name).join(', ');
      setValidationError(
        `Primary Vendor not assigned for this item (${names}). Please assign a Primary Vendor or remove the item before continuing.`
      );
      return;
    }

    if (itemsWithInvalidQty.length > 0) {
      const firstInvalid = itemsWithInvalidQty[0];
      setValidationError(
        `Please enter a valid manual quantity greater than 0 for "${firstInvalid.item.name}".`
      );
      qtyInputRefs.current[firstInvalid.item.id]?.focus();
      return;
    }

    // Expand all supplier groups by default in the preview screen
    const initialExpanded: Record<string, boolean> = {};
    const initialPhoneMap: Record<string, string> = {};
    supplierGroups.forEach((g) => {
      initialExpanded[g.vendorId] = true;
      initialPhoneMap[g.vendorId] = g.vendorPhone || '';
    });
    setExpandedVendorIds(initialExpanded);
    setEditingVendorPhone((prev) => ({ ...initialPhoneMap, ...prev }));
    setStep('PREVIEW');
  };

  const toggleExpandVendorGroup = (vendorId: string) => {
    setExpandedVendorIds((prev) => ({
      ...prev,
      [vendorId]: !prev[vendorId],
    }));
  };

  // Dispatch a single vendor group (creates PO once if not yet created, then sends via WhatsApp API)
  const executeSingleVendorDispatch = async (
    group: SupplierOrderGroup,
    indexOffset: number,
    existingRecord?: VendorDispatchRecord
  ): Promise<VendorDispatchRecord> => {
    const liveVendor = vendors.find((v) => v.id === group.vendorId);
    const phoneToUse = (
      editingVendorPhone[group.vendorId] ??
      existingRecord?.vendorPhone ??
      liveVendor?.phone ??
      liveVendor?.mobile ??
      group.vendorPhone ??
      ''
    ).trim();

    let createdPoId = existingRecord?.createdPoId;
    let poNumber = existingRecord?.poNumber;
    let poObject = existingRecord?.poObject;

    // Step 1: Create the separate vendor Purchase Order in Firestore ONLY ONCE
    if (!createdPoId || !poNumber || !poObject) {
      const uniqueSuffix = String((Date.now() + indexOffset * 7) % 1000000).padStart(6, '0');
      poNumber = `PO-${uniqueSuffix}`;

      const poItemsPayload = group.items.map((it) => ({
        itemId: it.item.id,
        itemName: it.item.name,
        unit: it.unit,
        orderedQty: it.orderedQty,
        estimatedRate: it.estimatedRate,
        estimatedAmount: it.estimatedAmount,
        reason: 'Supplier PO replenishment',
      }));

      createdPoId = await createPurchaseOrder(restaurantId, {
        poNumber,
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorPhone: phoneToUse,
        items: poItemsPayload,
        actorUid: userUid,
        actorName: userName,
      });

      const nowIso = new Date().toISOString();
      const totalEstimated = poItemsPayload.reduce((s, i) => s + i.estimatedAmount, 0);
      poObject = {
        id: createdPoId,
        poNumber,
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorPhone: phoneToUse,
        status: 'DRAFT',
        items: poItemsPayload.map((i) => ({
          itemId: i.itemId,
          itemName: i.itemName,
          unit: i.unit,
          orderedQty: i.orderedQty,
          recommendedQuantity: i.orderedQty,
          estimatedRate: i.estimatedRate,
          estimatedAmount: i.estimatedAmount,
          reason: i.reason,
          receivedQty: 0,
          missingQty: i.orderedQty,
          previouslyReceivedQty: 0,
          itemStatus: 'MISSING',
        })),
        totalEstimatedAmount: totalEstimated,
        estimatedTotal: totalEstimated,
        actualReceivedTotal: 0,
        restaurantId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    // Step 2: Format no-price WhatsApp message containing ONLY this vendor's items
    const messageBody = formatSupplierWhatsAppOrderMessage({
      restaurantName,
      poNumber,
      items: group.items.map((it) => ({
        itemName: it.item.name,
        orderedQty: it.orderedQty,
        unit: it.unit,
      })),
    });

    // Step 3: Send via official WhatsApp Business Cloud API
    try {
      const sendRes = await sendPoViaWhatsAppApi({
        restaurantId,
        purchaseOrderId: createdPoId,
        vendorId: group.vendorId,
        vendorPhone: phoneToUse,
        messageBody,
        po: poObject,
        userUid,
        userName,
        userRole: userRole || 'STOREKEEPER',
      });

      // Only mark SENT after official WhatsApp API accepts the message
      await updatePurchaseOrderStatus(
        restaurantId,
        createdPoId,
        'SENT',
        userUid,
        userName,
        {
          whatsappMessageId: sendRes.messageId,
          vendorPhone: sendRes.recipientPhone || phoneToUse,
          whatsappSessionInfo: 'Order sent via official WhatsApp Business Cloud API',
        }
      );

      onOrderSentOrUpdated?.();

      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorPhone: sendRes.recipientPhone || phoneToUse,
        items: group.items,
        createdPoId,
        poNumber,
        poObject: { ...poObject, status: 'SENT', vendorPhone: sendRes.recipientPhone || phoneToUse },
        messageBody,
        status: 'SENT',
        whatsappMessageId: sendRes.messageId,
      };
    } catch (sendErr: any) {
      // Do NOT mark failed orders as SENT — PO remains DRAFT in Firestore so it can be retried
      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorPhone: phoneToUse,
        items: group.items,
        createdPoId,
        poNumber,
        poObject,
        messageBody,
        status: 'FAILED',
        errorMessage:
          sendErr?.message ||
          'Failed to dispatch WhatsApp order. Please verify WhatsApp connection and vendor phone number.',
      };
    }
  };

  // Confirm & Send All Orders handler
  const handleConfirmAndSendAllOrders = async () => {
    if (isDispatchingAll) return;
    setValidationError(null);

    if (itemsMissingVendor.length > 0) {
      setValidationError('Primary Vendor not assigned for this item.');
      return;
    }

    if (itemsWithInvalidQty.length > 0 || supplierGroups.length === 0) {
      setValidationError('All selected items must have a valid quantity greater than zero.');
      return;
    }

    setStep('DISPATCH');
    setIsDispatchingAll(true);

    // Initialize all supplier groups to SENDING
    const initialRecords: Record<string, VendorDispatchRecord> = {};
    supplierGroups.forEach((group) => {
      const existing = dispatchRecords[group.vendorId];
      initialRecords[group.vendorId] = {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        vendorPhone: editingVendorPhone[group.vendorId] ?? group.vendorPhone ?? '',
        items: group.items,
        createdPoId: existing?.createdPoId,
        poNumber: existing?.poNumber,
        poObject: existing?.poObject,
        status: existing?.status === 'SENT' ? 'SENT' : 'SENDING',
        whatsappMessageId: existing?.whatsappMessageId,
      };
    });
    setDispatchRecords(initialRecords);

    // Process each supplier order independently so one failure never blocks or loses others
    for (let i = 0; i < supplierGroups.length; i++) {
      const group = supplierGroups[i];
      const existing = initialRecords[group.vendorId];
      if (existing?.status === 'SENT') continue;

      try {
        const updatedRecord = await executeSingleVendorDispatch(group, i + 1, existing);
        setDispatchRecords((prev) => ({
          ...prev,
          [group.vendorId]: updatedRecord,
        }));
      } catch (createErr: any) {
        setDispatchRecords((prev) => ({
          ...prev,
          [group.vendorId]: {
            vendorId: group.vendorId,
            vendorName: group.vendorName,
            vendorPhone: editingVendorPhone[group.vendorId] ?? group.vendorPhone ?? '',
            items: group.items,
            status: 'FAILED',
            errorMessage:
              createErr?.message || 'Failed to create Purchase Order in Firestore.',
          },
        }));
      }
    }

    setIsDispatchingAll(false);
  };

  // Retry a single failed vendor order without duplicating successful orders or creating a second PO
  const handleRetryVendorOrder = async (vendorId: string) => {
    const group = supplierGroups.find((g) => g.vendorId === vendorId);
    const existing = dispatchRecords[vendorId];
    if (!group || !existing || existing.status === 'SENDING' || existing.status === 'SENT') {
      return;
    }

    setDispatchRecords((prev) => ({
      ...prev,
      [vendorId]: {
        ...prev[vendorId],
        status: 'SENDING',
        errorMessage: undefined,
      },
    }));

    try {
      const updatedRecord = await executeSingleVendorDispatch(group, 1, existing);
      setDispatchRecords((prev) => ({
        ...prev,
        [vendorId]: updatedRecord,
      }));
    } catch (err: any) {
      setDispatchRecords((prev) => ({
        ...prev,
        [vendorId]: {
          ...prev[vendorId],
          status: 'FAILED',
          errorMessage: err?.message || 'Retry failed.',
        },
      }));
    }
  };

  // Save updated vendor phone number and optionally retry
  const handleSaveVendorPhoneInline = async (vendorId: string, autoRetryAfterSave = false) => {
    const rawPhone = (editingVendorPhone[vendorId] || '').trim();
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 10) {
      setDispatchRecords((prev) =>
        prev[vendorId]
          ? {
              ...prev[vendorId],
              errorMessage: 'Please enter a valid 10-digit WhatsApp mobile number.',
            }
          : prev
      );
      return;
    }

    try {
      setSavingVendorPhoneId(vendorId);
      await updateVendorContact(restaurantId, vendorId, rawPhone, userUid, userName);
      if (autoRetryAfterSave) {
        await handleRetryVendorOrder(vendorId);
      }
    } catch (err: any) {
      console.error('Failed to save vendor phone:', err);
    } finally {
      setSavingVendorPhoneId(null);
    }
  };

  // Manual WhatsApp fallback for a specific vendor PO if official Cloud API is not configured
  const handleOpenManualWhatsAppForVendor = async (record: VendorDispatchRecord) => {
    if (!record.createdPoId || !record.messageBody) return;
    const rawPhone = (editingVendorPhone[record.vendorId] ?? record.vendorPhone ?? '').trim();
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const normalizedDigits =
      cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    const encoded = encodeURIComponent(record.messageBody);
    const waUrl = normalizedDigits
      ? `https://wa.me/${normalizedDigits}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    try {
      await updatePurchaseOrderStatus(
        restaurantId,
        record.createdPoId,
        'SENT',
        userUid,
        userName,
        {
          vendorPhone: rawPhone,
          whatsappSessionInfo: 'Order opened via WhatsApp Web / App',
        }
      );
      setDispatchRecords((prev) => ({
        ...prev,
        [record.vendorId]: {
          ...prev[record.vendorId],
          status: 'SENT',
          errorMessage: undefined,
        },
      }));
      onOrderSentOrUpdated?.();
    } catch (err) {
      console.warn('Manual WhatsApp status update warning:', err);
    }
  };

  if (!isOpen) return null;

  const dispatchRecordsList = supplierGroups
    .map((g) => dispatchRecords[g.vendorId])
    .filter(Boolean);
  const sentOrdersCount = dispatchRecordsList.filter((r) => r.status === 'SENT').length;
  const failedOrdersCount = dispatchRecordsList.filter((r) => r.status === 'FAILED').length;

  return (
    <div
      id="smart-supplier-po-workspace"
      className="fixed inset-0 z-50 w-full h-screen h-[100dvh] bg-stone-50 flex flex-col overflow-hidden select-none sm:select-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-po-workspace-title"
    >
      {/* ================================================================= */}
      {/* STICKY TOP WORKSPACE HEADER                                       */}
      {/* ================================================================= */}
      <header className="shrink-0 bg-white border-b border-stone-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {step === 'PREVIEW' && (
            <button
              type="button"
              onClick={() => setStep('BUILD')}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-100 transition-colors shrink-0"
              aria-label="Back to item selection"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <h2
              id="smart-po-workspace-title"
              className="text-sm sm:text-base font-bold text-stone-900 truncate"
            >
              {step === 'BUILD'
                ? 'Create Supplier Purchase Order'
                : step === 'PREVIEW'
                ? `${supplierGroups.length} ${
                    supplierGroups.length === 1 ? 'SUPPLIER ORDER' : 'SUPPLIER ORDERS'
                  } READY`
                : 'Supplier Purchase Order Dispatch Status'}
            </h2>
            <p className="text-[11px] text-stone-500 truncate">
              {step === 'BUILD'
                ? 'Search inventory items, enter manual quantities, and group automatically by Primary Vendor'
                : step === 'PREVIEW'
                ? 'Review automatic supplier-wise order grouping before sending via WhatsApp'
                : 'Real-time Purchase Order creation and WhatsApp dispatch status per supplier'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            id="close-smart-po-workspace-btn"
            type="button"
            disabled={isDispatchingAll}
            onClick={onClose}
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <X className="w-4 h-4" />
            <span>{step === 'DISPATCH' ? 'Done' : 'Cancel'}</span>
          </button>
        </div>
      </header>

      {/* ================================================================= */}
      {/* SCROLLABLE MAIN WORKSPACE BODY                                    */}
      {/* ================================================================= */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-5">
          {/* Validation / Missing Vendor Banner */}
          {validationError && (
            <div
              id="po-workspace-validation-error"
              className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-start justify-between gap-3 text-xs text-rose-900"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Cannot Proceed with Purchase Order</p>
                  <p className="text-rose-800 leading-relaxed">{validationError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setValidationError(null)}
                className="p-1 rounded hover:bg-rose-100 text-rose-700 shrink-0"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ============================================================= */}
          {/* STEP 1: BUILD — SEARCH ITEMS, MANUAL QTY & AUTO VENDOR GROUP  */}
          {/* ============================================================= */}
          {step === 'BUILD' && (
            <>
              {/* Prominent Search Field at Top */}
              <div
                ref={searchContainerRef}
                className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 relative"
              >
                <label
                  htmlFor="po-item-search-input"
                  className="block text-xs font-bold text-stone-800 mb-2"
                >
                  Search & Add Inventory Items
                </label>

                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    id="po-item-search-input"
                    type="text"
                    autoComplete="off"
                    placeholder="Search Inventory Items..."
                    value={searchQuery}
                    onFocus={() => setIsSearchFocused(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsSearchFocused(true);
                    }}
                    className="w-full min-h-[44px] pl-10 pr-10 py-2.5 text-sm border border-stone-300 rounded-xl bg-stone-50/60 focus:bg-white focus:outline-none focus:border-amber-600 text-stone-900 placeholder:text-stone-400 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Fast Autocomplete Suggestions Dropdown */}
                {isSearchFocused && (
                  <div
                    id="po-item-search-suggestions"
                    className="mt-2 bg-white rounded-xl border border-stone-200 shadow-lg max-h-72 overflow-y-auto divide-y divide-stone-100 z-30"
                  >
                    {searchResults.length === 0 ? (
                      <div className="p-4 text-center text-xs text-stone-400">
                        No matching inventory items found for "{searchQuery}".
                      </div>
                    ) : (
                      searchResults.map((item) => {
                        const isAlreadySelected = selectedItemIdsSet.has(item.id);
                        const vInfo = resolveItemVendor(item);
                        return (
                          <button
                            key={item.id}
                            id={`po-search-option-${item.id}`}
                            type="button"
                            onClick={() => handleSelectItemFromSearch(item)}
                            className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors min-h-[52px] ${
                              isAlreadySelected
                                ? 'bg-amber-50/50 hover:bg-amber-50'
                                : 'hover:bg-stone-50'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs sm:text-sm font-bold text-stone-900 truncate">
                                  {item.name}
                                </span>
                                <span className="text-xs text-stone-500">· {item.unit}</span>
                                <span className="text-[11px] text-stone-400">· {item.category}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500 flex-wrap">
                                {vInfo.hasValidVendor ? (
                                  <span>
                                    Vendor: <strong className="text-stone-700">{vInfo.vendorName}</strong>
                                  </span>
                                ) : (
                                  <span className="text-rose-600 font-semibold">
                                    Primary Vendor not assigned for this item.
                                  </span>
                                )}
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  Available Stock: {item.currentStock} {item.unit}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0">
                              {isAlreadySelected ? (
                                <span className="text-xs font-semibold text-amber-700 whitespace-nowrap">
                                  Added (Edit Qty)
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-stone-900 underline-offset-2 hover:underline whitespace-nowrap">
                                  + Select Item
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Missing Vendor Alert Block if any selected item lacks a Primary Vendor */}
              {itemsMissingVendor.length > 0 && (
                <div
                  id="missing-vendor-warning-box"
                  className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3 text-xs text-amber-950"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-amber-950">
                        Primary Vendor not assigned for this item.
                      </p>
                      <p className="text-amber-900 leading-relaxed">
                        Every ordered item must have an assigned Primary Vendor so STOQO can group supplier orders accurately. Resolve or remove the affected item(s) below before proceeding:
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pl-6">
                    {itemsMissingVendor.map(({ item }) => (
                      <div
                        key={item.id}
                        className="bg-white rounded-lg border border-amber-200 p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-bold text-stone-900">{item.name}</span>
                          <span className="text-rose-600 font-semibold ml-2">
                            — Primary Vendor not assigned for this item.
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {vendors.length > 0 && (
                            <>
                              <select
                                value={assigningVendorForItem[item.id] || ''}
                                onChange={(e) =>
                                  setAssigningVendorForItem((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                className="min-h-[38px] px-2.5 py-1 text-xs border border-stone-300 rounded-lg bg-white text-stone-800"
                              >
                                <option value="">Assign Primary Vendor...</option>
                                {vendors.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={
                                  !assigningVendorForItem[item.id] ||
                                  savingItemVendorId === item.id
                                }
                                onClick={() => handleAssignPrimaryVendorToItem(item.id)}
                                className="min-h-[38px] px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
                              >
                                {savingItemVendorId === item.id ? 'Saving...' : 'Save Vendor'}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="min-h-[38px] px-3 py-1 border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold whitespace-nowrap"
                          >
                            Remove Item
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Clean Selected Items List (Desktop Table & Mobile Cards) */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-stone-200 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-stone-900">
                      Selected Order Items ({syncedSelectedItems.length})
                    </h3>
                    <p className="text-[11px] text-stone-500">
                      Enter order quantity manually for each item. Items are automatically grouped by their Primary Vendor.
                    </p>
                  </div>
                  {syncedSelectedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedItems([])}
                      className="text-xs font-semibold text-stone-500 hover:text-rose-600 transition-colors whitespace-nowrap"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {syncedSelectedItems.length === 0 ? (
                  <div className="p-10 sm:p-14 text-center space-y-2">
                    <Package className="w-8 h-8 text-stone-300 mx-auto" />
                    <p className="text-sm font-semibold text-stone-700">
                      No inventory items selected yet
                    </p>
                    <p className="text-xs text-stone-500 max-w-md mx-auto">
                      Use the search bar above to find items (e.g. Rice, Oil, Tomato, Sugar), select them, and enter the exact quantity to order.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop & Tablet Clean Table: ITEM | VENDOR | QTY | UNIT | ACTION */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-xs text-stone-700">
                        <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-600 uppercase tracking-wider">
                          <tr>
                            <th className="py-3 px-5">ITEM</th>
                            <th className="py-3 px-4">VENDOR</th>
                            <th className="py-3 px-4 w-48">QTY</th>
                            <th className="py-3 px-4 w-24">UNIT</th>
                            <th className="py-3 px-5 text-right w-28">ACTION</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {syncedSelectedItems.map(({ item, qtyInput }) => {
                            const vInfo = resolveItemVendor(item);
                            return (
                              <tr key={item.id} className="hover:bg-stone-50/70 transition-colors">
                                <td className="py-3.5 px-5">
                                  <p className="font-bold text-stone-900 text-sm">{item.name}</p>
                                  <p className="text-[11px] text-stone-500 mt-0.5">
                                    Vendor: {vInfo.hasValidVendor ? vInfo.vendorName : 'Unassigned'} · Available Stock:{' '}
                                    <span className="font-mono tabular-nums font-semibold text-stone-700">
                                      {item.currentStock} {item.unit}
                                    </span>
                                  </p>
                                </td>
                                <td className="py-3.5 px-4">
                                  {vInfo.hasValidVendor ? (
                                    <span className="font-semibold text-stone-800">
                                      {vInfo.vendorName}
                                    </span>
                                  ) : (
                                    <span className="text-rose-600 font-semibold">
                                      Primary Vendor not assigned for this item.
                                    </span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4">
                                  <input
                                    ref={(el) => {
                                      qtyInputRefs.current[item.id] = el;
                                    }}
                                    id={`po-qty-input-${item.id}`}
                                    type="number"
                                    inputMode="decimal"
                                    min="0.01"
                                    step="any"
                                    placeholder="Enter quantity"
                                    value={qtyInput}
                                    onChange={(e) => handleQtyChange(item.id, e.target.value)}
                                    className="w-40 min-h-[40px] px-3 py-1.5 text-sm font-mono tabular-nums font-bold text-stone-900 border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-amber-600 placeholder:font-sans placeholder:font-normal placeholder:text-stone-400"
                                  />
                                </td>
                                <td className="py-3.5 px-4 font-semibold text-stone-700">
                                  {item.unit}
                                </td>
                                <td className="py-3.5 px-5 text-right">
                                  <button
                                    id={`po-remove-item-${item.id}`}
                                    type="button"
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold inline-flex items-center gap-1 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Remove</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Touch-Friendly Stacked Item Cards */}
                    <div className="md:hidden divide-y divide-stone-200">
                      {syncedSelectedItems.map(({ item, qtyInput }) => {
                        const vInfo = resolveItemVendor(item);
                        return (
                          <div key={item.id} className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="text-sm font-bold text-stone-900">{item.name}</h4>
                                <p className="text-xs text-stone-600 mt-0.5">
                                  Vendor:{' '}
                                  {vInfo.hasValidVendor ? (
                                    <strong className="text-stone-900">{vInfo.vendorName}</strong>
                                  ) : (
                                    <span className="text-rose-600 font-semibold">
                                      Primary Vendor not assigned for this item.
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-stone-500 font-mono tabular-nums mt-0.5">
                                  Available Stock: {item.currentStock} {item.unit}
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveItem(item.id)}
                                className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-1 shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                                <span>Remove</span>
                              </button>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                                Order Quantity ({item.unit})
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  id={`mobile-po-qty-input-${item.id}`}
                                  type="number"
                                  inputMode="decimal"
                                  min="0.01"
                                  step="any"
                                  placeholder="Enter quantity"
                                  value={qtyInput}
                                  onChange={(e) => handleQtyChange(item.id, e.target.value)}
                                  className="flex-1 min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums font-bold text-stone-900 border border-stone-300 rounded-xl bg-white focus:outline-none focus:border-amber-600 placeholder:font-sans placeholder:font-normal placeholder:text-stone-400"
                                />
                                <span className="min-h-[44px] px-3.5 flex items-center justify-center rounded-xl bg-stone-100 text-stone-700 text-xs font-bold shrink-0">
                                  {item.unit}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Live Automatic Supplier Grouping Summary */}
              {supplierGroups.length > 0 && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-stone-900">
                        Automatic Supplier-Wise Grouping ({supplierGroups.length}{' '}
                        {supplierGroups.length === 1 ? 'Supplier Order' : 'Supplier Orders'})
                      </h4>
                      <p className="text-[11px] text-stone-500">
                        STOQO will create a separate Purchase Order for each supplier below.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {supplierGroups.map((group, idx) => (
                      <div
                        key={group.vendorId}
                        className="rounded-xl border border-stone-200 p-3.5 bg-stone-50/60 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-stone-900 truncate">
                            PO {idx + 1} — {group.vendorName}
                          </span>
                          <span className="text-[11px] text-stone-500 font-medium shrink-0">
                            {group.items.length} {group.items.length === 1 ? 'Item' : 'Items'}
                          </span>
                        </div>
                        <ul className="space-y-1 text-xs text-stone-700">
                          {group.items.map((it) => (
                            <li
                              key={it.item.id}
                              className="flex items-center justify-between gap-2 font-mono tabular-nums"
                            >
                              <span className="font-sans truncate">{it.item.name}</span>
                              <span className="font-semibold text-stone-900 shrink-0">
                                {it.orderedQty > 0 ? `${it.orderedQty} ${it.unit}` : `— ${it.unit}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ============================================================= */}
          {/* STEP 2: ORDER PREVIEW BEFORE SENDING                          */}
          {/* ============================================================= */}
          {step === 'PREVIEW' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    {supplierGroups.length}{' '}
                    {supplierGroups.length === 1 ? 'SUPPLIER ORDER' : 'SUPPLIER ORDERS'} READY
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Expand each supplier below to verify items, manual quantities, and WhatsApp message preview before sending.
                  </p>
                </div>
                <span className="text-xs font-semibold text-stone-600">
                  Total Items: {syncedSelectedItems.length}
                </span>
              </div>

              <div className="space-y-3">
                {supplierGroups.map((group, idx) => {
                  const isExpanded = expandedVendorIds[group.vendorId] ?? true;
                  const previewPoNumber = `PO-${idx + 1}`;
                  const previewMessage = formatSupplierWhatsAppOrderMessage({
                    restaurantName,
                    poNumber: previewPoNumber,
                    items: group.items.map((i) => ({
                      itemName: i.item.name,
                      orderedQty: i.orderedQty,
                      unit: i.unit,
                    })),
                  });

                  return (
                    <div
                      key={group.vendorId}
                      id={`preview-supplier-group-${group.vendorId}`}
                      className="bg-white rounded-xl border border-stone-200 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpandVendorGroup(group.vendorId)}
                        className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-stone-50 transition-colors min-h-[56px]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
                          )}
                          <Building2 className="w-4 h-4 text-stone-700 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-stone-900 truncate">
                              {group.vendorName}
                            </p>
                            <p className="text-xs text-stone-500">
                              {group.items.length} {group.items.length === 1 ? 'Item' : 'Items'}
                            </p>
                          </div>
                        </div>

                        <div className="text-xs text-stone-500 font-medium shrink-0">
                          {isExpanded ? 'Hide Details' : 'Expand Items'}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 sm:px-5 pb-4 pt-2 border-t border-stone-100 space-y-4">
                          {/* Supplier Items & Quantities */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs text-stone-700">
                              <thead className="text-[11px] font-bold text-stone-500 uppercase border-b border-stone-200">
                                <tr>
                                  <th className="py-2 pr-4">ITEM</th>
                                  <th className="py-2 px-4 text-right">QTY</th>
                                  <th className="py-2 pl-4">UNIT</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-stone-100">
                                {group.items.map((it) => (
                                  <tr key={it.item.id}>
                                    <td className="py-2.5 pr-4 font-semibold text-stone-900">
                                      {it.item.name}
                                    </td>
                                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-stone-900">
                                      {it.orderedQty}
                                    </td>
                                    <td className="py-2.5 pl-4 text-stone-600">{it.unit}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Vendor WhatsApp Number check / edit */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-stone-100 text-xs">
                            <div className="flex items-center gap-2 text-stone-600">
                              <Phone className="w-3.5 h-3.5 text-stone-400" />
                              <span>Vendor WhatsApp Number:</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="tel"
                                placeholder="Enter 10-digit WhatsApp number"
                                value={editingVendorPhone[group.vendorId] ?? group.vendorPhone ?? ''}
                                onChange={(e) =>
                                  setEditingVendorPhone((prev) => ({
                                    ...prev,
                                    [group.vendorId]: e.target.value,
                                  }))
                                }
                                className="min-h-[38px] px-3 py-1 text-xs font-mono border border-stone-300 rounded-lg bg-white text-stone-900 w-48"
                              />
                              {(editingVendorPhone[group.vendorId] ?? '') !==
                                (group.vendorPhone ?? '') && (
                                <button
                                  type="button"
                                  disabled={savingVendorPhoneId === group.vendorId}
                                  onClick={() => handleSaveVendorPhoneInline(group.vendorId, false)}
                                  className="min-h-[38px] px-3 py-1 bg-stone-900 text-white rounded-lg text-xs font-semibold"
                                >
                                  {savingVendorPhoneId === group.vendorId ? 'Saving...' : 'Save'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* No-Price WhatsApp Message Preview */}
                          <div className="bg-stone-900 text-emerald-400 rounded-xl p-3.5 font-mono text-[11px] whitespace-pre overflow-x-auto leading-relaxed">
                            {previewMessage}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================= */}
          {/* STEP 3: PER-VENDOR SENDING STATUS & RETRY                     */}
          {/* ============================================================= */}
          {step === 'DISPATCH' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    Supplier Order Dispatch Results
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Each supplier Purchase Order is created separately and sent only its own items via WhatsApp.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <span className="text-emerald-700">Sent: {sentOrdersCount}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-rose-700">Failed: {failedOrdersCount}</span>
                </div>
              </div>

              <div className="space-y-3">
                {supplierGroups.map((group) => {
                  const rec = dispatchRecords[group.vendorId];
                  const status = rec?.status || 'IDLE';

                  return (
                    <div
                      key={group.vendorId}
                      id={`dispatch-vendor-card-${group.vendorId}`}
                      className="bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-stone-900">
                              {group.vendorName} —{' '}
                              <span
                                className={
                                  status === 'SENT'
                                    ? 'text-emerald-700'
                                    : status === 'FAILED'
                                    ? 'text-rose-600'
                                    : 'text-amber-700'
                                }
                              >
                                {status}
                              </span>
                            </span>
                            {rec?.poNumber && (
                              <span className="text-xs font-mono text-stone-500">
                                ({rec.poNumber})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-stone-500 mt-0.5">
                            {group.items
                              .map((it) => `${it.item.name} (${it.orderedQty} ${it.unit})`)
                              .join(', ')}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {status === 'SENDING' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Sending...
                            </span>
                          )}
                          {status === 'SENT' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              SENT
                            </span>
                          )}
                          {status === 'FAILED' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600">
                              <AlertTriangle className="w-4 h-4 text-rose-600" />
                              FAILED
                            </span>
                          )}
                        </div>
                      </div>

                      {status === 'FAILED' && rec && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 space-y-3 text-xs text-rose-900">
                          <p className="font-medium">
                            {rec.errorMessage || 'WhatsApp dispatch failed for this supplier.'}
                          </p>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="tel"
                                placeholder="Vendor WhatsApp phone"
                                value={editingVendorPhone[group.vendorId] ?? rec.vendorPhone ?? ''}
                                onChange={(e) =>
                                  setEditingVendorPhone((prev) => ({
                                    ...prev,
                                    [group.vendorId]: e.target.value,
                                  }))
                                }
                                className="min-h-[38px] px-3 py-1 text-xs font-mono border border-rose-300 rounded-lg bg-white text-stone-900 w-48"
                              />
                              <button
                                type="button"
                                disabled={savingVendorPhoneId === group.vendorId}
                                onClick={() => handleSaveVendorPhoneInline(group.vendorId, true)}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-semibold"
                              >
                                {savingVendorPhoneId === group.vendorId
                                  ? 'Saving...'
                                  : 'Save Phone & Retry'}
                              </button>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {rec.createdPoId && rec.messageBody && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenManualWhatsAppForVendor(rec)}
                                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-semibold inline-flex items-center gap-1.5"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Open in WhatsApp</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                id={`retry-vendor-po-${group.vendorId}`}
                                type="button"
                                onClick={() => handleRetryVendorOrder(group.vendorId)}
                                className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1.5"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retry WhatsApp Send</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* STICKY BOTTOM PRIMARY ACTION BAR                                  */}
      {/* ================================================================= */}
      <footer className="shrink-0 bg-white border-t border-stone-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs text-stone-600 flex items-center gap-2 flex-wrap">
            <span>
              Selected Items: <strong className="text-stone-900">{syncedSelectedItems.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Supplier Orders: <strong className="text-stone-900">{supplierGroups.length}</strong>
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            {step === 'BUILD' && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  id="po-review-supplier-orders-btn"
                  type="button"
                  disabled={syncedSelectedItems.length === 0}
                  onClick={handleProceedToPreview}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-bold transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  Review Supplier Orders ({supplierGroups.length})
                </button>
              </>
            )}

            {step === 'PREVIEW' && (
              <>
                <button
                  id="po-preview-cancel-btn"
                  type="button"
                  disabled={isDispatchingAll}
                  onClick={() => setStep('BUILD')}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  id="po-confirm-send-all-btn"
                  type="button"
                  disabled={isDispatchingAll || supplierGroups.length === 0}
                  onClick={handleConfirmAndSendAllOrders}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  <span>Confirm & Send All Orders</span>
                </button>
              </>
            )}

            {step === 'DISPATCH' && (
              <button
                id="po-dispatch-finish-btn"
                type="button"
                disabled={isDispatchingAll}
                onClick={onClose}
                className="min-h-[44px] px-6 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs sm:text-sm font-bold transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {isDispatchingAll ? 'Sending Orders...' : 'Close & View Purchase Orders'}
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
