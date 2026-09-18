import React, { useEffect, useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Phone,
  Camera,
  Upload,
  X,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
  Smartphone,
  MessageSquare,
  RefreshCw,
  PackageCheck,
  Ban,
  FileCheck,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, uploadInvoiceImage } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import {
  PurchaseOrder,
  Vendor,
  Item,
  PurchaseOrderItem,
  PurchaseOrderStatus,
} from '../types';
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  updateVendorContact,
  receivePurchaseOrderTransaction,
  ReceiveOrderLineItem,
} from '../services/restaurantService';
import { exportPurchaseOrderPdf } from '../services/exportService';
import { sendPoViaWhatsAppApi, fetchWhatsAppStatus } from '../services/whatsappClient';
import { WhatsAppPoHistory } from '../components/whatsapp/WhatsAppPoHistory';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

interface WhatsAppModalState {
  isOpen: boolean;
  po: PurchaseOrder | null;
  vendorPhone: string;
  messageText: string;
  isSending: boolean;
  isNotConnected?: boolean;
  errorMessage?: string;
}

interface ReceiveModalState {
  isOpen: boolean;
  po: PurchaseOrder | null;
  billNumber: string;
  billDate: string;
  vendorInvoiceTotal: number;
  items: {
    itemId: string;
    itemName: string;
    unit: string;
    orderedQty: number;
    previouslyReceivedQty: number;
    newlyReceivedQty: number;
    estimatedRate: number;
    actualRate: number;
  }[];
  invoiceImageFile: File | null;
  invoiceImagePreview: string | null;
  isOverride: boolean;
  overrideReason: string;
  confirmDifference: boolean;
  isSubmitting: boolean;
}

export const PurchaseOrdersView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, activeRole } = useAuth();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Official WhatsApp Business Platform connection state
  const [whatsAppConnected, setWhatsAppConnected] = useState<boolean>(false);
  const [whatsAppNumber, setWhatsAppNumber] = useState<string>('');

  // Create PO Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [createPoItems, setCreatePoItems] = useState<{
    itemId: string;
    itemName: string;
    unit: string;
    orderedQty: number;
    estimatedRate: number;
    estimatedAmount: number;
    reason: string;
  }[]>([]);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Vendor Phone Quick Update Modal
  const [phoneModal, setPhoneModal] = useState<{
    isOpen: boolean;
    vendorId: string;
    vendorName: string;
    phone: string;
    poIdPending?: string;
  }>({
    isOpen: false,
    vendorId: '',
    vendorName: '',
    phone: '',
  });

  // WhatsApp Send & Confirmation Modal
  const [whatsappModal, setWhatsappModal] = useState<WhatsAppModalState>({
    isOpen: false,
    po: null,
    vendorPhone: '',
    messageText: '',
    isSending: false,
  });

  // Receive Order Modal
  const [receiveModal, setReceiveModal] = useState<ReceiveModalState>({
    isOpen: false,
    po: null,
    billNumber: '',
    billDate: new Date().toISOString().slice(0, 10),
    vendorInvoiceTotal: 0,
    items: [],
    invoiceImageFile: null,
    invoiceImagePreview: null,
    isOverride: false,
    overrideReason: '',
    confirmDifference: false,
    isSubmitting: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';
  const priceHikeThreshold = activeRestaurant?.priceHikeThresholdPercent ?? 2.0;

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubOrders = onSnapshot(
      query(
        collection(db, 'restaurants', activeRestaurantId, 'purchaseOrders'),
        orderBy('createdAt', 'desc'),
        limit(100)
      ),
      (snap) => {
        setOrders(snap.docs.map((d) => d.data() as PurchaseOrder));
        setLoading(false);
      }
    );

    const unsubVendors = onSnapshot(
      collection(db, 'restaurants', activeRestaurantId, 'vendors'),
      (snap) => {
        setVendors(snap.docs.map((d) => d.data() as Vendor));
      }
    );

    const unsubItems = onSnapshot(
      collection(db, 'restaurants', activeRestaurantId, 'items'),
      (snap) => {
        setItems(snap.docs.map((d) => d.data() as Item));
      }
    );

    return () => {
      unsubOrders();
      unsubVendors();
      unsubItems();
    };
  }, [activeRestaurantId]);

  // Listen to official WhatsApp Business settings
  useEffect(() => {
    if (!activeRestaurantId) return;
    const unsub = onSnapshot(
      doc(db, 'restaurants', activeRestaurantId, 'settings', 'whatsapp'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setWhatsAppConnected(d.connected === true);
          setWhatsAppNumber(d.businessPhoneNumber || '');
        } else {
          setWhatsAppConnected(false);
          setWhatsAppNumber('');
        }
      },
      (err) => {
        console.warn('WhatsApp settings listener notice:', err);
      }
    );
    return () => unsub();
  }, [activeRestaurantId]);

  // -------------------------------------------------------------------------
  // CREATE PO WORKFLOW
  // -------------------------------------------------------------------------
  const openCreateModal = () => {
    const firstVendor = vendors[0];
    setSelectedVendorId(firstVendor?.id || '');
    populateVendorItems(firstVendor?.id || '');
    setIsCreateOpen(true);
  };

  const populateVendorItems = (vId: string) => {
    const matching = items.filter((i) => !vId || i.primaryVendorId === vId);
    const candidateItems = matching.length > 0 ? matching : items.slice(0, 6);

    const rows = candidateItems.map((item) => {
      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const target = item.maximumStock || item.minimumStock * 2 || 10;
      const needed = Math.max(0, target - item.currentStock);
      const qty = needed > 0 ? needed : 5;
      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        orderedQty: qty,
        estimatedRate: rate,
        estimatedAmount: Number((qty * rate).toFixed(2)),
        reason: 'Restocking required',
      };
    });
    setCreatePoItems(rows);
  };

  const handleCreateVendorChange = (vId: string) => {
    setSelectedVendorId(vId);
    populateVendorItems(vId);
  };

  const updateCreateItemQty = (idx: number, qty: number) => {
    const updated = [...createPoItems];
    const item = updated[idx];
    item.orderedQty = Math.max(0, Number(qty) || 0);
    item.estimatedAmount = Number((item.orderedQty * item.estimatedRate).toFixed(2));
    updated[idx] = item;
    setCreatePoItems(updated);
  };

  const removeCreateItemRow = (idx: number) => {
    if (createPoItems.length > 1) {
      setCreatePoItems(createPoItems.filter((_, i) => i !== idx));
    }
  };

  const createTotalEstimated = createPoItems.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const handleSavePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !selectedVendorId || createPoItems.length === 0) return;

    const vendor = vendors.find((v) => v.id === selectedVendorId);
    try {
      setCreateSubmitting(true);
      await createPurchaseOrder(activeRestaurantId, {
        vendorId: selectedVendorId,
        vendorName: vendor?.name || 'Vendor',
        vendorPhone: vendor?.phone || vendor?.mobile || '',
        items: createPoItems,
        actorUid: user?.uid || 'system',
        actorName: userProfile?.name || 'Authorized User',
      });
      setIsCreateOpen(false);
    } catch (err) {
      console.error('Failed to create purchase order:', err);
    } finally {
      setCreateSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // WHATSAPP WORKFLOW
  // -------------------------------------------------------------------------
  const generateWhatsAppMessage = (po: PurchaseOrder, vendorName: string) => {
    const storeName = activeRestaurant?.name || 'Restaurant Store';
    const itemsText = po.items
      .map((it, idx) => {
        const qty = it.orderedQty || it.recommendedQuantity || 0;
        return `${idx + 1}. *${it.itemName}* — ${qty} ${it.unit} (Est. Rate: ${currencySymbol}${it.estimatedRate.toFixed(2)})`;
      })
      .join('\n');

    const totalVal = (po.estimatedTotal || po.totalEstimatedAmount || 0).toFixed(2);

    return `*PURCHASE ORDER: ${po.poNumber}*\n*From:* ${storeName}\n*To:* ${vendorName}\n*Date:* ${new Date(
      po.createdAt
    ).toLocaleDateString()}\n\n*ITEMS REQUIRED:*\n${itemsText}\n\n*Total Estimated Value:* ${currencySymbol}${totalVal}\n\nPlease confirm availability, dispatch schedule, and invoice total.\n\nRegards,\n${storeName} Store Management`;
  };

  const handleInitiateWhatsAppSend = async (po: PurchaseOrder) => {
    if (!activeRestaurantId) return;

    // Check if vendor has phone number
    const vendor = vendors.find((v) => v.id === po.vendorId);
    const phone = po.vendorPhone || vendor?.phone || vendor?.mobile || '';
    const cleanDigits = phone.replace(/[^0-9]/g, '');

    if (!phone.trim() || cleanDigits.length < 10) {
      // Prompt user to update phone number
      setPhoneModal({
        isOpen: true,
        vendorId: po.vendorId,
        vendorName: po.vendorName,
        phone: phone || '',
        poIdPending: po.id,
      });
      return;
    }

    // Check if WhatsApp Business is connected for this restaurant
    try {
      const statusRes = await fetchWhatsAppStatus(activeRestaurantId);
      if (!statusRes.connected) {
        setWhatsappModal({
          isOpen: true,
          po,
          vendorPhone: phone,
          messageText: '',
          isSending: false,
          isNotConnected: true,
          errorMessage: 'WhatsApp not connected. Please ask the Owner to connect WhatsApp Business in Settings.',
        });
        return;
      }
    } catch (e: any) {
      console.warn('Failed to verify WhatsApp connection status:', e);
    }

    const messageText = generateWhatsAppMessage(po, po.vendorName);

    // Open official cloud API dispatch modal (no WhatsApp Web / no browser window.open)
    setWhatsappModal({
      isOpen: true,
      po,
      vendorPhone: phone,
      messageText,
      isSending: false,
      isNotConnected: false,
      errorMessage: '',
    });
  };

  const handleExecuteWhatsAppSend = async () => {
    if (!activeRestaurantId || !whatsappModal.po) return;
    const targetPo = whatsappModal.po;

    try {
      setWhatsappModal((prev) => ({ ...prev, isSending: true, errorMessage: '' }));

      // Update PO status to PENDING_SEND before transmission
      try {
        await updatePurchaseOrderStatus(
          activeRestaurantId,
          targetPo.id,
          'PENDING_SEND',
          user?.uid || 'system',
          userProfile?.name || 'Authorized User',
          {
            whatsappSessionInfo: `Transmitting via official WhatsApp Business Platform...`,
          }
        );
      } catch (statusErr) {
        console.warn('Failed to set initial PENDING_SEND status:', statusErr);
      }

      // Call dedicated WhatsApp backend server
      const res = await sendPoViaWhatsAppApi({
        restaurantId: activeRestaurantId,
        purchaseOrderId: targetPo.id,
        vendorId: targetPo.vendorId,
        userUid: user?.uid || 'staff',
        userName: userProfile?.name || 'Staff User',
        userRole: activeRole || 'DEPARTMENT_STAFF',
      });

      setWhatsappModal((prev) => ({ ...prev, isOpen: false, isSending: false, errorMessage: '' }));
      alert(`PO #${targetPo.poNumber} successfully transmitted to vendor via WhatsApp Cloud API! (Message ID: ${res.messageId})`);
    } catch (err: any) {
      console.error('Failed to dispatch PO via WhatsApp Cloud API:', err);
      // Status remains PENDING_SEND, show clear error to user, allow retry
      const errMsg = err.message || 'WhatsApp Cloud API dispatch failed. Please retry.';
      setWhatsappModal((prev) => ({
        ...prev,
        isSending: false,
        errorMessage: errMsg,
      }));
    }
  };

  const handleSaveVendorPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !phoneModal.vendorId || !phoneModal.phone.trim()) return;

    const cleanDigits = phoneModal.phone.replace(/[^0-9]/g, '');
    if (cleanDigits.length < 10) {
      alert('Invalid WhatsApp number. Mobile number must contain at least 10 digits.');
      return;
    }

    try {
      await updateVendorContact(
        activeRestaurantId,
        phoneModal.vendorId,
        phoneModal.phone.trim(),
        user?.uid,
        userProfile?.name
      );

      const pendingPoId = phoneModal.poIdPending;
      setPhoneModal({ isOpen: false, vendorId: '', vendorName: '', phone: '' });

      // If there was a pending PO send, trigger it now
      if (pendingPoId) {
        const targetPo = orders.find((o) => o.id === pendingPoId);
        if (targetPo) {
          targetPo.vendorPhone = phoneModal.phone.trim();
          handleInitiateWhatsAppSend(targetPo);
        }
      }
    } catch (e) {
      console.error('Failed to update vendor phone:', e);
    }
  };

  const handleCancelPo = async (po: PurchaseOrder) => {
    if (!activeRestaurantId) return;
    const confirmed = window.confirm(`Are you sure you want to cancel Purchase Order ${po.poNumber}?`);
    if (!confirmed) return;

    try {
      await updatePurchaseOrderStatus(
        activeRestaurantId,
        po.id,
        'CANCELLED',
        user?.uid || 'system',
        userProfile?.name || 'Authorized User',
        { cancelReason: 'Cancelled by user request' }
      );
    } catch (err) {
      console.error('Failed to cancel PO:', err);
    }
  };

  // -------------------------------------------------------------------------
  // RECEIVE ORDER WORKFLOW
  // -------------------------------------------------------------------------
  const openReceiveModal = (po: PurchaseOrder) => {
    const modalItems = po.items.map((item) => {
      const ordered = item.orderedQty || item.recommendedQuantity || 0;
      const prevRecv = item.previouslyReceivedQty || item.receivedQty || 0;
      const remainingNeeded = Math.max(0, ordered - prevRecv);
      const estRate = item.estimatedRate || 0;
      const actualRate = item.actualRate || estRate;

      return {
        itemId: item.itemId,
        itemName: item.itemName,
        unit: item.unit,
        orderedQty: ordered,
        previouslyReceivedQty: prevRecv,
        newlyReceivedQty: remainingNeeded, // default to remaining
        estimatedRate: estRate,
        actualRate: actualRate,
      };
    });

    const initialSum = modalItems.reduce(
      (sum, it) => sum + it.newlyReceivedQty * it.actualRate,
      0
    );

    setReceiveModal({
      isOpen: true,
      po,
      billNumber: '',
      billDate: new Date().toISOString().slice(0, 10),
      vendorInvoiceTotal: Number(initialSum.toFixed(2)),
      items: modalItems,
      invoiceImageFile: null,
      invoiceImagePreview: null,
      isOverride: false,
      overrideReason: '',
      confirmDifference: false,
      isSubmitting: false,
    });
  };

  const updateReceiveItemField = (
    idx: number,
    field: 'newlyReceivedQty' | 'actualRate',
    val: number
  ) => {
    const updated = [...receiveModal.items];
    const row = updated[idx];
    if (field === 'newlyReceivedQty') {
      row.newlyReceivedQty = Math.max(0, Number(val) || 0);
    } else if (field === 'actualRate') {
      row.actualRate = Math.max(0, Number(val) || 0);
    }
    updated[idx] = row;

    const recalculatedTotal = updated.reduce(
      (sum, it) => sum + it.newlyReceivedQty * it.actualRate,
      0
    );

    setReceiveModal((prev) => ({
      ...prev,
      items: updated,
      // If user hasn't typed a custom bill total, keep it synced
      vendorInvoiceTotal:
        prev.vendorInvoiceTotal === 0 || prev.vendorInvoiceTotal === undefined
          ? Number(recalculatedTotal.toFixed(2))
          : prev.vendorInvoiceTotal,
    }));
  };

  // Image Upload Handling
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setReceiveModal((prev) => ({
        ...prev,
        invoiceImageFile: file,
        invoiceImagePreview: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setReceiveModal((prev) => ({
      ...prev,
      invoiceImageFile: null,
      invoiceImagePreview: null,
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Calculations inside Receive Modal
  const calculatedInvoiceTotal = Number(
    receiveModal.items
      .reduce((sum, it) => sum + it.newlyReceivedQty * it.actualRate, 0)
      .toFixed(2)
  );

  const invoiceDifference = Number(
    Math.abs(calculatedInvoiceTotal - receiveModal.vendorInvoiceTotal).toFixed(2)
  );

  const hasInvoiceTotalMismatch = invoiceDifference > 0.05;

  // Price hike check
  const priceHikedItems = receiveModal.items.filter((it) => {
    if (it.estimatedRate <= 0 || it.newlyReceivedQty <= 0) return false;
    const pct = ((it.actualRate - it.estimatedRate) / it.estimatedRate) * 100;
    return pct >= priceHikeThreshold;
  });

  const hasPriceHike = priceHikedItems.length > 0;

  const handleConfirmReceiveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !receiveModal.po) return;

    if (!receiveModal.billNumber.trim()) {
      alert('Please enter the Vendor Invoice / Bill Number.');
      return;
    }

    if (receiveModal.vendorInvoiceTotal <= 0) {
      alert('Please enter the Vendor Invoice Total as stated on the physical bill.');
      return;
    }

    const itemsReceiving = receiveModal.items.filter((it) => it.newlyReceivedQty > 0);
    if (itemsReceiving.length === 0) {
      alert('Please specify a received quantity greater than 0 for at least one item.');
      return;
    }

    if (hasPriceHike && !receiveModal.overrideReason.trim()) {
      alert(
        `Price hike detected (+${priceHikeThreshold}%). A manager safeguard override reason is required.`
      );
      return;
    }

    if (hasInvoiceTotalMismatch && !receiveModal.confirmDifference) {
      alert(
        `Invoice total mismatch of ${currencySymbol}${invoiceDifference.toFixed(
          2
        )}. Please verify line totals or check "Confirm Invoice Difference" to proceed.`
      );
      return;
    }

    try {
      setReceiveModal((prev) => ({ ...prev, isSubmitting: true }));

      // Upload invoice image if provided
      let invoiceImageUrl = '';
      let invoiceImagePath = '';

      if (receiveModal.invoiceImageFile) {
        const uploadRes = await uploadInvoiceImage(
          activeRestaurantId,
          receiveModal.po.id,
          receiveModal.invoiceImageFile
        );
        invoiceImageUrl = uploadRes.downloadUrl;
        invoiceImagePath = uploadRes.storagePath;
      }

      // Format payload for atomic receive transaction
      const lineItems: ReceiveOrderLineItem[] = receiveModal.items.map((it) => {
        const totalAfter = it.previouslyReceivedQty + it.newlyReceivedQty;
        const itemStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'MISSING' =
          totalAfter >= it.orderedQty
            ? 'RECEIVED'
            : totalAfter > 0
            ? 'PARTIALLY_RECEIVED'
            : 'MISSING';

        return {
          itemId: it.itemId,
          itemName: it.itemName,
          unit: it.unit,
          orderedQty: it.orderedQty,
          newlyReceivedQty: it.newlyReceivedQty,
          actualRate: it.actualRate,
          estimatedRate: it.estimatedRate,
          estimatedAmount: Number((it.orderedQty * it.estimatedRate).toFixed(2)),
          itemStatus,
        };
      });

      await receivePurchaseOrderTransaction({
        restaurantId: activeRestaurantId,
        poId: receiveModal.po.id,
        billNumber: receiveModal.billNumber.trim(),
        billDate: receiveModal.billDate,
        vendorInvoiceTotal: receiveModal.vendorInvoiceTotal,
        isOverride: hasPriceHike || hasInvoiceTotalMismatch,
        overrideReason:
          receiveModal.overrideReason ||
          (hasPriceHike
            ? `Price hike confirmed by ${userProfile?.name || 'Manager'}`
            : hasInvoiceTotalMismatch
            ? `Difference of ${currencySymbol}${invoiceDifference.toFixed(2)} verified on bill`
            : 'Normal inward receipt'),
        invoiceImageUrl,
        invoiceImagePath,
        items: lineItems,
        recordedByUid: user?.uid || 'system',
        recordedByName: userProfile?.name || 'Authorized User',
        priceHikeThresholdPercent: priceHikeThreshold,
      });

      setReceiveModal((prev) => ({ ...prev, isOpen: false, isSubmitting: false }));
    } catch (err: any) {
      console.error('Failed to receive purchase order:', err);
      alert(err?.message || 'Failed to complete goods inward transaction. Please try again.');
      setReceiveModal((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  // Filtered orders list
  const filteredOrders = orders.filter((o) => {
    if (statusFilter === 'ALL') return true;
    return o.status === statusFilter;
  });

  const getStatusBadgeVariant = (status: PurchaseOrderStatus) => {
    switch (status) {
      case 'SENT':
        return 'success';
      case 'RECEIVED':
        return 'success';
      case 'PARTIALLY_RECEIVED':
        return 'info';
      case 'PENDING_SEND':
        return 'warning';
      case 'DRAFT':
        return 'neutral';
      case 'CANCELLED':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Supplier Purchase Orders (PO)
            </h1>
            <Badge variant="neutral" size="sm">
              {orders.length} Total Orders
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            End-to-end procurement: Create PO → Dispatch via WhatsApp Web → Inward Delivery & Invoice Verification → Automatic Stock & Costing Update.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Official WhatsApp Cloud API Status Indicator */}
          <div
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${
              whatsAppConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-stone-50 text-stone-600 border-stone-200'
            }`}
            title={
              whatsAppConnected
                ? `Official WhatsApp Cloud API connected: ${whatsAppNumber}`
                : 'WhatsApp not connected. Owner can connect in Settings.'
            }
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span
              className={`w-2 h-2 rounded-full ${
                whatsAppConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span>
              {whatsAppConnected
                ? `WhatsApp Connected (${whatsAppNumber})`
                : 'WhatsApp Not Connected'}
            </span>
          </div>

          <button
            id="create-po-btn"
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Purchase Order
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-stone-200 p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'DRAFT', 'PENDING_SEND', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const).map(
            (st) => {
              const count =
                st === 'ALL'
                  ? orders.length
                  : orders.filter((o) => o.status === st).length;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 text-xs rounded-lg font-medium whitespace-nowrap transition-colors ${
                    statusFilter === st
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {st.replace(/_/g, ' ')} ({count})
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12 text-stone-400 text-xs">
            Loading real purchase orders from Firestore...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center text-stone-400">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-stone-300" />
            <p className="text-sm font-semibold text-stone-700">No Purchase Orders in this status</p>
            <p className="text-xs text-stone-400 mt-1">
              Create a supplier PO to replenish required items and dispatch directly via WhatsApp.
            </p>
          </div>
        ) : (
          filteredOrders.map((po) => {
            const vendor = vendors.find((v) => v.id === po.vendorId);
            const vendorPhone = po.vendorPhone || vendor?.phone || vendor?.mobile;
            const totalEst = po.estimatedTotal || po.totalEstimatedAmount || 0;

            return (
              <div
                key={po.id}
                className="bg-white rounded-xl border border-stone-200 p-5 shadow-2xs space-y-4 hover:border-stone-300 transition-colors"
              >
                {/* PO Header Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono font-bold text-stone-900 text-sm">
                      {po.poNumber}
                    </span>
                    <span className="text-xs font-semibold text-stone-800">
                      • {po.vendorName}
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        po.status === 'SENT'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : po.status === 'RECEIVED'
                          ? 'bg-teal-100 text-teal-800 border border-teal-300'
                          : po.status === 'PARTIALLY_RECEIVED'
                          ? 'bg-sky-100 text-sky-800 border border-sky-300'
                          : po.status === 'PENDING_SEND'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : po.status === 'CANCELLED'
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-stone-100 text-stone-700 border border-stone-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          po.status === 'SENT'
                            ? 'bg-emerald-600'
                            : po.status === 'RECEIVED'
                            ? 'bg-teal-600'
                            : po.status === 'PARTIALLY_RECEIVED'
                            ? 'bg-sky-600'
                            : po.status === 'PENDING_SEND'
                            ? 'bg-amber-600'
                            : 'bg-stone-400'
                        }`}
                      />
                      {po.status.replace(/_/g, ' ')}
                    </span>

                    {/* Vendor Contact pill */}
                    {vendorPhone ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                        <Phone className="w-3 h-3 text-stone-400" />
                        {vendorPhone}
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          setPhoneModal({
                            isOpen: true,
                            vendorId: po.vendorId,
                            vendorName: po.vendorName,
                            phone: '',
                            poIdPending: po.id,
                          })
                        }
                        className="text-[10px] text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-200"
                      >
                        + Add Phone
                      </button>
                    )}
                  </div>

                  {/* Actions according to Status */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* PDF Export always available */}
                    <button
                      onClick={() =>
                        exportPurchaseOrderPdf(
                          po,
                          activeRestaurant?.name || 'Restaurant',
                          currencySymbol,
                          activeRestaurant?.address
                        )
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-stone-200 hover:bg-stone-50 rounded-lg text-stone-700 font-medium transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print / PDF
                    </button>

                    {/* DRAFT actions */}
                    {po.status === 'DRAFT' && (
                      <>
                        <button
                          onClick={() => handleInitiateWhatsAppSend(po)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-2xs transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" /> Send via WhatsApp
                        </button>
                        <button
                          onClick={() => handleCancelPo(po)}
                          className="px-2 py-1.5 text-xs text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Cancel Order"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    {/* PENDING_SEND actions */}
                    {po.status === 'PENDING_SEND' && (
                      <>
                        <button
                          onClick={() => handleInitiateWhatsAppSend(po)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold shadow-2xs transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Retry WhatsApp
                        </button>
                        <button
                          onClick={() => handleCancelPo(po)}
                          className="px-2 py-1.5 text-xs text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Cancel Order"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    {/* SENT actions */}
                    {po.status === 'SENT' && (
                      <button
                        onClick={() => openReceiveModal(po)}
                        className="flex items-center gap-1 px-3.5 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold shadow-2xs transition-colors"
                      >
                        <PackageCheck className="w-4 h-4" /> Receive Order
                      </button>
                    )}

                    {/* PARTIALLY_RECEIVED actions */}
                    {po.status === 'PARTIALLY_RECEIVED' && (
                      <button
                        onClick={() => openReceiveModal(po)}
                        className="flex items-center gap-1 px-3.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold shadow-2xs transition-colors"
                      >
                        <PackageCheck className="w-4 h-4" /> Receive Balance
                      </button>
                    )}

                    {/* RECEIVED: view linked bill */}
                    {po.status === 'RECEIVED' && po.billNumber && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-teal-50 text-teal-800 rounded-lg font-medium border border-teal-200">
                        <FileCheck className="w-3.5 h-3.5 text-teal-600" />
                        Bill #{po.billNumber}
                      </span>
                    )}
                  </div>
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-600">
                    <thead className="text-[10px] uppercase text-stone-400 border-b border-stone-100">
                      <tr>
                        <th className="py-2 px-2">Item</th>
                        <th className="py-2 px-2 text-right">Ordered Qty</th>
                        {(po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED') && (
                          <>
                            <th className="py-2 px-2 text-right text-teal-700">Received</th>
                            <th className="py-2 px-2 text-right text-amber-700">Missing</th>
                            <th className="py-2 px-2 text-right">Actual Rate</th>
                          </>
                        )}
                        <th className="py-2 px-2 text-right">Est. Rate</th>
                        <th className="py-2 px-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {po.items.map((item, i) => {
                        const ordered = item.orderedQty || item.recommendedQuantity || 0;
                        const received = item.receivedQty || 0;
                        const missing = item.missingQty ?? Math.max(0, ordered - received);
                        const isReceivedStatus =
                          po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED';

                        return (
                          <tr key={i} className="hover:bg-stone-50/60">
                            <td className="py-2 px-2 font-medium text-stone-800">
                              {item.itemName}
                            </td>
                            <td className="py-2 px-2 text-right font-bold text-stone-900">
                              {ordered} {item.unit}
                            </td>
                            {isReceivedStatus && (
                              <>
                                <td className="py-2 px-2 text-right font-semibold text-teal-700">
                                  {received} {item.unit}
                                </td>
                                <td className="py-2 px-2 text-right font-semibold text-amber-700">
                                  {missing > 0 ? `${missing} ${item.unit}` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right text-stone-700 font-mono">
                                  {currencySymbol}
                                  {(item.actualRate || item.estimatedRate).toFixed(2)}
                                </td>
                              </>
                            )}
                            <td className="py-2 px-2 text-right text-stone-500 font-mono">
                              {currencySymbol}
                              {item.estimatedRate.toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-right font-semibold text-stone-900 font-mono">
                              {currencySymbol}
                              {(isReceivedStatus && item.actualAmount
                                ? item.actualAmount
                                : item.estimatedAmount || ordered * item.estimatedRate
                              ).toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer Metadata */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs pt-2 border-t border-stone-100 text-stone-500">
                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <span>Created: {new Date(po.createdAt).toLocaleDateString()}</span>
                    {po.sentAt && (
                      <span className="text-emerald-700">
                        • Dispatched: {new Date(po.sentAt).toLocaleDateString()}
                      </span>
                    )}
                    {po.receivedAt && (
                      <span className="text-teal-700">
                        • Received: {new Date(po.receivedAt).toLocaleDateString()} by{' '}
                        {po.receivedByName || 'Staff'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-stone-400">
                      Est. Total: {currencySymbol}
                      {totalEst.toFixed(2)}
                    </span>
                    {po.actualReceivedTotal ? (
                      <span className="font-bold text-teal-800 text-sm">
                        Inward Value: {currencySymbol}
                        {po.actualReceivedTotal.toFixed(2)}
                      </span>
                    ) : (
                      <span className="font-bold text-stone-900 text-sm">
                        Value: {currencySymbol}
                        {totalEst.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Official WhatsApp Cloud API Delivery Timeline & History */}
                <WhatsAppPoHistory
                  restaurantId={activeRestaurantId}
                  po={po}
                  onResend={handleInitiateWhatsAppSend}
                  isSending={whatsappModal.isSending && whatsappModal.po?.id === po.id}
                />
              </div>
            );
          })
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 1: CREATE PURCHASE ORDER                                      */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Supplier Purchase Order"
        subtitle="Consolidate items and prepare supplier procurement order"
        maxWidth="2xl"
      >
        <form onSubmit={handleSavePo} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Select Supplier / Vendor *
            </label>
            <select
              required
              value={selectedVendorId}
              onChange={(e) => handleCreateVendorChange(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-amber-500"
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} {v.phone ? `(${v.phone})` : '(No phone)'}
                </option>
              ))}
            </select>
          </div>

          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="p-3 bg-stone-50 border-b border-stone-200 flex justify-between items-center">
              <h4 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Order Items ({createPoItems.length})
              </h4>
              <span className="text-[11px] text-stone-500">
                Stock replenishment requirements
              </span>
            </div>

            <div className="p-3 space-y-2 max-h-72 overflow-y-auto divide-y divide-stone-100">
              {createPoItems.map((item, idx) => (
                <div
                  key={idx}
                  className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-stone-900">{item.itemName}</p>
                    <p className="text-[10px] text-stone-400">
                      Rate: {currencySymbol}
                      {item.estimatedRate.toFixed(2)} / {item.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-stone-500 sm:hidden">Qty:</label>
                    <input
                      type="number"
                      min={0.1}
                      step="any"
                      value={item.orderedQty}
                      onChange={(e) => updateCreateItemQty(idx, Number(e.target.value))}
                      className="w-20 px-2 py-1 text-xs border border-stone-300 rounded-md text-right font-bold focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-stone-500 w-10">{item.unit}</span>
                    <span className="font-bold text-stone-900 w-24 text-right font-mono">
                      {currencySymbol}
                      {item.estimatedAmount.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCreateItemRow(idx)}
                      className="p-1 text-stone-400 hover:text-rose-600 rounded"
                      title="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-stone-50 border-t border-stone-200 flex justify-between items-center text-xs">
              <span className="font-bold text-stone-700">Estimated Total:</span>
              <span className="text-sm font-black text-stone-900 font-mono">
                {currencySymbol}
                {createTotalEstimated.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createSubmitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-colors"
            >
              {createSubmitting ? 'Saving...' : 'Save as Draft PO'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 2: VENDOR PHONE CONFIGURATION                                 */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={phoneModal.isOpen}
        onClose={() => setPhoneModal({ isOpen: false, vendorId: '', vendorName: '', phone: '' })}
        title="Vendor WhatsApp Number Required"
        subtitle={`Configure mobile number for ${phoneModal.vendorName}`}
        maxWidth="md"
      >
        <form onSubmit={handleSaveVendorPhone} className="space-y-4">
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2.5 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              WhatsApp purchase orders require a valid phone number with country code (e.g., 919876543210 or 9876543210).
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              WhatsApp Mobile Number *
            </label>
            <input
              type="tel"
              required
              placeholder="e.g. 9876543210"
              value={phoneModal.phone}
              onChange={(e) => setPhoneModal((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 font-mono"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setPhoneModal({ isOpen: false, vendorId: '', vendorName: '', phone: '' })}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              Save & Proceed
            </button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 3: OFFICIAL WHATSAPP BUSINESS PLATFORM CLOUD API DISPATCH      */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={whatsappModal.isOpen}
        onClose={() => setWhatsappModal((prev) => ({ ...prev, isOpen: false }))}
        title={
          whatsappModal.isNotConnected
            ? 'WhatsApp Business Not Connected'
            : 'Send Purchase Order via WhatsApp'
        }
        subtitle={
          whatsappModal.isNotConnected
            ? 'Owner connection required for automated dispatches'
            : `Official Meta Cloud API • Order ${whatsappModal.po?.poNumber} to ${whatsappModal.po?.vendorName}`
        }
        maxWidth="lg"
      >
        {whatsappModal.isNotConnected ? (
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-3 text-rose-900">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-sm">🔴 WhatsApp Not Connected</p>
                <p className="text-rose-800">
                  Please ask the Owner to connect WhatsApp Business before sending purchase orders.
                </p>
                <p className="text-[11px] text-stone-600 mt-1">
                  The restaurant store control system sends Purchase Orders directly through the official Meta WhatsApp Business Cloud API. Staff do not need WhatsApp Web or QR codes, but the restaurant's official number must be connected once by the Owner in <strong>Settings → WhatsApp Business</strong>.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setWhatsappModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold"
              >
                Close Notice
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Meta Cloud API info banner */}
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-start gap-2.5 text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Official WhatsApp Cloud API Dispatch</p>
                <p className="text-[11px] mt-0.5 text-emerald-700">
                  This PO will be dispatched directly to vendor mobile{' '}
                  <strong className="font-mono">{whatsappModal.vendorPhone}</strong> from the restaurant's verified WhatsApp Business account.
                </p>
              </div>
            </div>

            {/* Error banner if transmission failed */}
            {whatsappModal.errorMessage && (
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2 text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">WhatsApp Cloud API Error:</p>
                  <p className="text-[11px] mt-0.5">{whatsappModal.errorMessage}</p>
                  <p className="text-[10px] text-stone-500 mt-1">
                    The PO remains in PENDING_SEND status so you can retry or verify credentials.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Purchase Order Message Preview
              </label>
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-[11px] text-stone-800 whitespace-pre-line max-h-52 overflow-y-auto select-text">
                {whatsappModal.messageText}
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row justify-end gap-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setWhatsappModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={whatsappModal.isSending}
                onClick={handleExecuteWhatsAppSend}
                className="flex items-center justify-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-colors"
              >
                {whatsappModal.isSending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Transmitting via Cloud API...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    {whatsappModal.errorMessage ? 'Retry WhatsApp' : 'Send via WhatsApp Cloud API'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 4: RECEIVE ORDER & INVOICE VERIFICATION                       */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={receiveModal.isOpen}
        onClose={() => setReceiveModal((prev) => ({ ...prev, isOpen: false }))}
        title="Receive Order & Inward Invoice"
        subtitle={`Verify goods delivery for ${receiveModal.po?.poNumber} (${receiveModal.po?.vendorName})`}
        maxWidth="3xl"
      >
        <form onSubmit={handleConfirmReceiveOrder} className="space-y-4">
          {/* Bill Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
            <div>
              <label className="block text-[11px] font-bold text-stone-700 uppercase tracking-wider mb-1">
                Vendor Bill / Invoice # *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. INV-45821"
                value={receiveModal.billNumber}
                onChange={(e) => setReceiveModal((prev) => ({ ...prev, billNumber: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg bg-white font-mono font-bold focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-stone-700 uppercase tracking-wider mb-1">
                Bill Date *
              </label>
              <input
                type="date"
                required
                value={receiveModal.billDate}
                onChange={(e) => setReceiveModal((prev) => ({ ...prev, billDate: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-stone-700 uppercase tracking-wider mb-1">
                Vendor Bill Total ({currencySymbol}) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="Printed invoice total"
                value={receiveModal.vendorInvoiceTotal || ''}
                onChange={(e) =>
                  setReceiveModal((prev) => ({
                    ...prev,
                    vendorInvoiceTotal: Number(e.target.value) || 0,
                  }))
                }
                className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg bg-white font-mono font-bold text-right focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          {/* Upload Bill / Invoice Photo */}
          <div className="p-3 border border-stone-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-stone-500" />
                Upload Bill / Invoice Photo (Camera or File)
              </label>
              {receiveModal.invoiceImagePreview && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="text-xs text-rose-600 hover:underline flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Remove Photo
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                capture="environment"
                onChange={handleImageSelect}
                className="text-xs text-stone-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-stone-100 file:text-stone-700 hover:file:bg-stone-200 cursor-pointer"
              />
              {receiveModal.invoiceImagePreview && (
                <div className="flex items-center gap-2">
                  <img
                    src={receiveModal.invoiceImagePreview}
                    alt="Invoice Preview"
                    className="w-12 h-12 object-cover rounded-lg border border-stone-300"
                  />
                  <span className="text-[11px] text-emerald-700 font-medium">
                    Photo attached
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Items Inward Verification Table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="p-2.5 bg-stone-50 border-b border-stone-200 flex justify-between items-center text-xs">
              <span className="font-bold text-stone-800 uppercase tracking-wider">
                Delivered Items & Rates
              </span>
              <span className="text-stone-500 text-[11px]">
                Enter received quantities and actual invoice rates
              </span>
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs text-stone-600">
                <thead className="bg-stone-100/70 border-b border-stone-200 text-[10px] uppercase text-stone-500 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-2 text-right">Ordered</th>
                    <th className="py-2 px-2 text-right text-teal-800">Recv Qty</th>
                    <th className="py-2 px-2 text-right text-amber-800">Missing</th>
                    <th className="py-2 px-2 text-right">Est. Rate</th>
                    <th className="py-2 px-2 text-right text-teal-800">Invoice Rate</th>
                    <th className="py-2 px-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {receiveModal.items.map((it, idx) => {
                    const missing = Math.max(
                      0,
                      it.orderedQty - (it.previouslyReceivedQty + it.newlyReceivedQty)
                    );
                    const lineTotal = Number((it.newlyReceivedQty * it.actualRate).toFixed(2));
                    const priceDiff = it.actualRate - it.estimatedRate;
                    const priceDiffPct =
                      it.estimatedRate > 0 ? (priceDiff / it.estimatedRate) * 100 : 0;
                    const isHiked = priceDiffPct >= priceHikeThreshold;

                    return (
                      <tr key={it.itemId} className="hover:bg-stone-50">
                        <td className="py-2.5 px-3 font-medium text-stone-900">
                          <div>
                            <span>{it.itemName}</span>
                            {it.previouslyReceivedQty > 0 && (
                              <span className="block text-[10px] text-stone-400">
                                Prev received: {it.previouslyReceivedQty} {it.unit}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-semibold text-stone-700">
                          {it.orderedQty} {it.unit}
                        </td>

                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={it.newlyReceivedQty}
                            onChange={(e) =>
                              updateReceiveItemField(idx, 'newlyReceivedQty', Number(e.target.value))
                            }
                            className="w-20 px-2 py-1 text-xs border border-stone-300 rounded text-right font-bold text-teal-800 focus:outline-none focus:border-teal-500"
                          />
                        </td>

                        <td className="py-2.5 px-2 text-right font-bold text-amber-700">
                          {missing > 0 ? `${missing} ${it.unit}` : '0'}
                        </td>

                        <td className="py-2.5 px-2 text-right text-stone-500 font-mono">
                          {currencySymbol}
                          {it.estimatedRate.toFixed(2)}
                        </td>

                        <td className="py-2.5 px-2 text-right">
                          <div className="flex flex-col items-end">
                            <input
                              type="number"
                              min={0.01}
                              step="0.01"
                              value={it.actualRate}
                              onChange={(e) =>
                                updateReceiveItemField(idx, 'actualRate', Number(e.target.value))
                              }
                              className={`w-20 px-2 py-1 text-xs border rounded text-right font-mono font-bold focus:outline-none ${
                                isHiked
                                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                                  : 'border-stone-300 text-stone-900 focus:border-teal-500'
                              }`}
                            />
                            {priceDiff !== 0 && (
                              <span
                                className={`text-[10px] font-mono mt-0.5 ${
                                  priceDiff > 0 ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {priceDiff > 0 ? '+' : ''}
                                {currencySymbol}
                                {priceDiff.toFixed(2)} ({priceDiffPct.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-bold text-stone-900 font-mono">
                          {currencySymbol}
                          {lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Total Comparison Row */}
            <div className="p-3 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-stone-500">Calculated Items Total: </span>
                <span className="font-bold text-stone-900 font-mono text-sm">
                  {currencySymbol}
                  {calculatedInvoiceTotal.toFixed(2)}
                </span>
              </div>

              {/* Match / Mismatch Badge */}
              <div>
                {!hasInvoiceTotalMismatch ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 font-semibold text-[11px] border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Invoice Total Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 font-semibold text-[11px] border border-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5" /> Total Mismatch: Difference{' '}
                    {currencySymbol}
                    {invoiceDifference.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Warning & Override section for Price Hike */}
          {hasPriceHike && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Safeguard Protection: Vendor Price Hike Exceeds {priceHikeThreshold}%</span>
              </div>
              <p className="text-[11px] text-amber-800">
                The actual invoice rate on{' '}
                {priceHikedItems.map((h) => h.itemName).join(', ')} is higher than previous purchase / estimated rate. Manager override is required.
              </p>
              <textarea
                required
                rows={2}
                placeholder="Enter mandatory reason for approving price hike..."
                value={receiveModal.overrideReason}
                onChange={(e) =>
                  setReceiveModal((prev) => ({ ...prev, overrideReason: e.target.value }))
                }
                className="w-full p-2 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-600"
              />
            </div>
          )}

          {/* Mismatch confirmation checkbox */}
          {hasInvoiceTotalMismatch && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 space-y-1 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-rose-900">
                <input
                  type="checkbox"
                  checked={receiveModal.confirmDifference}
                  onChange={(e) =>
                    setReceiveModal((prev) => ({
                      ...prev,
                      confirmDifference: e.target.checked,
                    }))
                  }
                  className="rounded text-rose-600 focus:ring-rose-500"
                />
                Confirm Invoice Discrepancy of {currencySymbol}
                {invoiceDifference.toFixed(2)} (Bill ₹{receiveModal.vendorInvoiceTotal.toFixed(2)} vs
                Items ₹{calculatedInvoiceTotal.toFixed(2)})
              </label>
              <p className="text-[10px] text-rose-700 pl-5">
                Authorized override will be logged in the immutable audit trail.
              </p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setReceiveModal((prev) => ({ ...prev, isOpen: false }))}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={receiveModal.isSubmitting}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <PackageCheck className="w-4 h-4" />
              {receiveModal.isSubmitting ? 'Updating Inventory...' : 'Receive Order & Update Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
