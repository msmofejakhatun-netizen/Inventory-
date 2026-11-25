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
  Pencil,
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
  updateDraftPurchaseOrder,
  updatePurchaseOrderStatus,
  updateVendorContact,
  receivePurchaseOrderTransaction,
  ReceiveOrderLineItem,
} from '../services/restaurantService';
import { exportPurchaseOrderPdf } from '../services/exportService';
import { sendPoViaWhatsAppApi, fetchWhatsAppStatus } from '../services/whatsappClient';
import { WhatsAppPoHistory } from '../components/whatsapp/WhatsAppPoHistory';
import { SmartSupplierPoWorkspace } from '../components/purchaseOrders/SmartSupplierPoWorkspace';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export function normalizePurchaseOrderStatus(rawStatus: any): PurchaseOrderStatus {
  if (!rawStatus) return 'DRAFT';
  const s = String(rawStatus).trim().toUpperCase();
  if (s === 'SENT' || s === 'WHATSAPP_SENT' || s === 'ORDER_SENT' || s === 'DISPATCHED') {
    return 'SENT';
  }
  if (s === 'PARTIALLY_RECEIVED' || s === 'PARTIAL' || s === 'PARTIALLY RECEIVED') {
    return 'PARTIALLY_RECEIVED';
  }
  if (s === 'RECEIVED' || s === 'FULFILLED' || s === 'COMPLETED') {
    return 'RECEIVED';
  }
  if (s === 'CANCELLED' || s === 'CANCELED') {
    return 'CANCELLED';
  }
  if (s === 'PENDING_SEND' || s === 'SENDING' || s === 'PENDING') {
    return 'PENDING_SEND';
  }
  return 'DRAFT';
}

interface WhatsAppModalState {
  isOpen: boolean;
  po: PurchaseOrder | null;
  vendorPhone: string;
  messageText: string;
  isSending: boolean;
  isNotConnected?: boolean;
  errorMessage?: string;
  successMessage?: string;
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

  // Full-Screen Smart Supplier-Wise PO Workspace state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Edit Draft Purchase Order Modal state (tax-free: Qty x Rate = Amount, Grand Total = Sum)
  const [editPoModal, setEditPoModal] = useState<{
    isOpen: boolean;
    po: PurchaseOrder | null;
    items: {
      itemId: string;
      itemName: string;
      unit: string;
      orderedQty: number;
      estimatedRate: number;
      reason?: string;
    }[];
    isSaving: boolean;
    error: string | null;
  }>({
    isOpen: false,
    po: null,
    items: [],
    isSaving: false,
    error: null,
  });

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
    errorMessage: '',
    successMessage: '',
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
        const loadedOrders = snap.docs.map((d) => {
          const data = d.data();
          const rawStatus = data?.status ?? (data as any)?.poStatus ?? (data as any)?.orderStatus;
          return {
            ...data,
            id: d.id,
            status: normalizePurchaseOrderStatus(rawStatus),
          } as PurchaseOrder;
        });
        setOrders(loadedOrders);
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
  // CREATE PO WORKFLOW (FULL-SCREEN SMART SUPPLIER-WISE WORKSPACE)
  // -------------------------------------------------------------------------
  const openCreateModal = () => {
    setIsCreateOpen(true);
  };

  // -------------------------------------------------------------------------
  // EDIT DRAFT PO WORKFLOW (TAX-FREE: QTY x RATE = AMOUNT)
  // -------------------------------------------------------------------------
  const openEditPoModal = (po: PurchaseOrder) => {
    setEditPoModal({
      isOpen: true,
      po,
      items: (po.items || []).map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        unit: item.unit,
        orderedQty: Number(item.orderedQty ?? item.recommendedQuantity ?? 0) || 0,
        estimatedRate: Number(item.estimatedRate ?? 0) || 0,
        reason: item.reason,
      })),
      isSaving: false,
      error: null,
    });
  };

  const handleSaveEditPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !editPoModal.po) return;

    const validItems = editPoModal.items.filter((i) => (Number(i.orderedQty) || 0) > 0);
    if (validItems.length === 0) {
      setEditPoModal((prev) => ({
        ...prev,
        error: 'Please keep at least one item with a quantity greater than 0.',
      }));
      return;
    }

    try {
      setEditPoModal((prev) => ({ ...prev, isSaving: true, error: null }));
      await updateDraftPurchaseOrder(
        activeRestaurantId,
        editPoModal.po.id,
        editPoModal.po.poNumber,
        validItems,
        user?.uid || 'system',
        userProfile?.name || user?.displayName || 'Authorized User'
      );
      setEditPoModal({ isOpen: false, po: null, items: [], isSaving: false, error: null });
    } catch (err: any) {
      console.error('Failed to update draft PO:', err);
      setEditPoModal((prev) => ({
        ...prev,
        isSaving: false,
        error: err?.message || 'Failed to update Purchase Order.',
      }));
    }
  };

  // -------------------------------------------------------------------------
  // WHATSAPP WORKFLOW (STRICTLY ONLY ITEM + QUANTITY + UNIT • NO PRICES/RATES/AMOUNTS)
  // -------------------------------------------------------------------------
  const generateWhatsAppMessage = (po: PurchaseOrder, vendorName: string) => {
    const storeName = activeRestaurant?.name || 'STOQO';
    const poDate = po.createdAt
      ? new Date(po.createdAt).toLocaleDateString('en-IN')
      : new Date().toLocaleDateString('en-IN');

    const items = po.items || [];
    const itemsTable = items
      .map((item) => {
        const name = (item.itemName || 'ITEM').toUpperCase().trim();
        const qty = item.orderedQty ?? item.recommendedQuantity ?? 0;
        const unit = (item.unit || 'UNIT').toUpperCase().trim();

        const paddedName = name.padEnd(28, ' ');
        const paddedQty = String(qty).padEnd(10, ' ');
        return `${paddedName} ${paddedQty} ${unit}`;
      })
      .join('\n');

    return `🛒 PURCHASE ORDER

${storeName.toUpperCase()}
Vendor: ${vendorName.toUpperCase()}
PO Number: ${po.poNumber}
Date: ${poDate}

ITEM                         QTY        UNIT
------------------------------------------------
${itemsTable}
------------------------------------------------

Please confirm receipt and delivery schedule.`;
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

    const messageText = generateWhatsAppMessage(po, po.vendorName);

    // Check official WhatsApp Cloud API connection status in background
    let isConnected = false;
    try {
      const statusRes = await fetchWhatsAppStatus(activeRestaurantId);
      isConnected = !!statusRes.connected;
    } catch (e: any) {
      console.warn('Failed to verify WhatsApp connection status:', e);
    }

    setWhatsappModal({
      isOpen: true,
      po,
      vendorPhone: phone,
      messageText,
      isSending: false,
      isNotConnected: !isConnected,
      errorMessage: '',
      successMessage: '',
    });
  };

  const handleOpenInWhatsAppManual = async () => {
    if (!whatsappModal.po) return;
    const phone = whatsappModal.vendorPhone;
    const cleanDigits = phone.replace(/[^0-9]/g, '');
    const encodedText = encodeURIComponent(whatsappModal.messageText);
    const waUrl = cleanDigits
      ? `https://wa.me/${cleanDigits}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    // Also update PO status in Firestore to SENT so user can immediately receive the order
    if (activeRestaurantId && whatsappModal.po.id) {
      try {
        await updatePurchaseOrderStatus(
          activeRestaurantId,
          whatsappModal.po.id,
          'SENT',
          user?.uid || 'system',
          userProfile?.name || 'Staff User',
          {
            vendorPhone: whatsappModal.vendorPhone,
            whatsappSessionInfo: 'Order opened via WhatsApp Web / App',
          }
        );

        setOrders((prev) =>
          prev.map((o) =>
            o.id === whatsappModal.po!.id
              ? {
                  ...o,
                  status: 'SENT',
                  vendorPhone: whatsappModal.vendorPhone,
                  sentAt: new Date().toISOString(),
                }
              : o
          )
        );

        if (statusFilter === 'DRAFT') {
          setStatusFilter('ALL');
        }

        setWhatsappModal((prev) => ({ ...prev, isOpen: false }));
      } catch (manualErr) {
        console.warn('Manual WhatsApp PO status update note:', manualErr);
      }
    }
  };

  const handleExecuteWhatsAppSend = async () => {
    if (!activeRestaurantId || !whatsappModal.po) return;
    const targetPo = whatsappModal.po;

    try {
      setWhatsappModal((prev) => ({ ...prev, isSending: true, errorMessage: '' }));

      // Call dedicated WhatsApp backend server
      const res = await sendPoViaWhatsAppApi({
        restaurantId: activeRestaurantId,
        purchaseOrderId: targetPo.id,
        vendorId: targetPo.vendorId,
        vendorPhone: whatsappModal.vendorPhone,
        messageBody: whatsappModal.messageText,
        po: targetPo,
        userUid: user?.uid || 'staff',
        userName: userProfile?.name || 'Staff User',
        userRole: activeRole || 'DEPARTMENT_STAFF',
      });

      // Update PO status to SENT in Firestore (Source of Truth)
      try {
        await updatePurchaseOrderStatus(
          activeRestaurantId,
          targetPo.id,
          'SENT',
          user?.uid || 'system',
          userProfile?.name || 'Authorized User',
          {
            whatsappMessageId: res.messageId,
            vendorPhone: whatsappModal.vendorPhone,
            whatsappSessionInfo: 'Order sent via official WhatsApp Business Cloud API',
          }
        );
      } catch (statusErr) {
        console.warn('Status update warning:', statusErr);
      }

      // Invalidate and update local state immediately so Receive Order button shows up right away
      setOrders((prev) =>
        prev.map((o) =>
          o.id === targetPo.id
            ? {
                ...o,
                status: 'SENT',
                whatsappMessageId: res.messageId,
                vendorPhone: whatsappModal.vendorPhone,
                sentAt: new Date().toISOString(),
              }
            : o
        )
      );

      // If user is currently filtering by DRAFT, switch to ALL so the updated SENT order remains in view
      if (statusFilter === 'DRAFT') {
        setStatusFilter('ALL');
      }

      setWhatsappModal((prev) => ({ ...prev, isOpen: false, isSending: false, errorMessage: '' }));
      alert(`PO #${targetPo.poNumber} successfully sent to vendor via WhatsApp! Status updated to SENT. You can now receive this order.`);
    } catch (err: any) {
      console.error('Failed to dispatch PO via WhatsApp Cloud API:', err);
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
    return normalizePurchaseOrderStatus(o.status ?? (o as any).poStatus ?? (o as any).orderStatus) === statusFilter;
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
                  : orders.filter((o) => normalizePurchaseOrderStatus(o.status ?? (o as any).poStatus ?? (o as any).orderStatus) === st).length;
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
            const status = normalizePurchaseOrderStatus(po.status ?? (po as any).poStatus ?? (po as any).orderStatus);

            return (
              <div
                key={po.id}
                id={`po-card-${po.id}`}
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
                        status === 'SENT'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : status === 'RECEIVED'
                          ? 'bg-teal-100 text-teal-800 border border-teal-300'
                          : status === 'PARTIALLY_RECEIVED'
                          ? 'bg-sky-100 text-sky-800 border border-sky-300'
                          : status === 'PENDING_SEND'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : status === 'CANCELLED'
                          ? 'bg-rose-100 text-rose-800 border border-rose-300'
                          : 'bg-stone-100 text-stone-700 border border-stone-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          status === 'SENT'
                            ? 'bg-emerald-600'
                            : status === 'RECEIVED'
                            ? 'bg-teal-600'
                            : status === 'PARTIALLY_RECEIVED'
                            ? 'bg-sky-600'
                            : status === 'PENDING_SEND'
                            ? 'bg-amber-600'
                            : 'bg-stone-400'
                        }`}
                      />
                      {status.replace(/_/g, ' ')}
                    </span>

                    {/* Vendor Contact pill */}
                    {vendorPhone ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                        <Phone className="w-3 h-3 text-stone-400" />
                        {vendorPhone}
                      </span>
                    ) : (
                      <button
                        id={`btn-add-phone-${po.id}`}
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
                      id={`btn-pdf-${po.id}`}
                      onClick={() =>
                        exportPurchaseOrderPdf(
                          po,
                          activeRestaurant?.name || 'Restaurant',
                          currencySymbol,
                          activeRestaurant?.address,
                          activeRestaurant?.timezone
                        )
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-stone-200 hover:bg-stone-50 rounded-lg text-stone-700 font-medium transition-colors shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print / PDF
                    </button>

                    {/* DRAFT actions: Edit PO, WhatsApp Order, Cancel */}
                    {status === 'DRAFT' && (
                      <>
                        <button
                          id={`btn-edit-po-${po.id}`}
                          onClick={() => openEditPoModal(po)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-stone-200 hover:bg-stone-50 rounded-lg text-stone-700 font-medium transition-colors shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit PO
                        </button>
                        <button
                          id={`btn-whatsapp-order-${po.id}`}
                          onClick={() => handleInitiateWhatsAppSend(po)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-2xs transition-colors shrink-0"
                        >
                          <MessageSquare className="w-3.5 h-3.5" /> WhatsApp Order
                        </button>
                        <button
                          id={`btn-cancel-po-${po.id}`}
                          onClick={() => handleCancelPo(po)}
                          className="px-2 py-1.5 text-xs text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                          title="Cancel Order"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    {/* PENDING_SEND actions: show "Sending..." / disabled button */}
                    {status === 'PENDING_SEND' && (
                      <button
                        id={`btn-sending-${po.id}`}
                        disabled
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500/70 text-white rounded-lg font-semibold shadow-2xs opacity-80 cursor-not-allowed shrink-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending...
                      </button>
                    )}

                    {/* SENT actions: show "Receive Order" */}
                    {status === 'SENT' && (
                      <button
                        id={`btn-receive-order-${po.id}`}
                        onClick={() => openReceiveModal(po)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold shadow-2xs transition-colors shrink-0"
                      >
                        <PackageCheck className="w-4 h-4" /> Receive Order
                      </button>
                    )}

                    {/* PARTIALLY_RECEIVED actions: show "Receive Order" */}
                    {status === 'PARTIALLY_RECEIVED' && (
                      <button
                        id={`btn-receive-order-partial-${po.id}`}
                        onClick={() => openReceiveModal(po)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold shadow-2xs transition-colors shrink-0"
                      >
                        <PackageCheck className="w-4 h-4" /> Receive Order
                      </button>
                    )}

                    {/* RECEIVED: show "View Receiving Details" */}
                    {status === 'RECEIVED' && (
                      <button
                        id={`btn-view-receiving-${po.id}`}
                        onClick={() => openReceiveModal(po)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg font-medium border border-stone-200 transition-colors shrink-0"
                      >
                        <FileCheck className="w-3.5 h-3.5 text-teal-600" />
                        {po.billNumber ? `Bill #${po.billNumber} • View Details` : 'View Receiving Details'}
                      </button>
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
                        {(status === 'RECEIVED' || status === 'PARTIALLY_RECEIVED') && (
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
                      {(po.items || []).map((item, i) => {
                        const ordered = Number(item.orderedQty || item.recommendedQuantity || 0) || 0;
                        const received = Number(item.receivedQty || 0) || 0;
                        const missing = item.missingQty ?? Math.max(0, ordered - received);
                        const estRate = Number(item.estimatedRate || 0) || 0;
                        const actualRate = Number(item.actualRate || estRate) || 0;
                        const isReceivedStatus =
                          status === 'RECEIVED' || status === 'PARTIALLY_RECEIVED';
                        const lineAmount = isReceivedStatus
                          ? Number((received * actualRate).toFixed(2))
                          : Number((ordered * estRate).toFixed(2));

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
                                  {actualRate.toFixed(2)}
                                </td>
                              </>
                            )}
                            <td className="py-2 px-2 text-right text-stone-500 font-mono">
                              {currencySymbol}
                              {estRate.toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-right font-semibold text-stone-900 font-mono">
                              {currencySymbol}
                              {lineAmount.toFixed(2)}
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
      {/* FULL-SCREEN SMART SUPPLIER-WISE PURCHASE ORDER WORKSPACE            */}
      {/* ------------------------------------------------------------------- */}
      {activeRestaurantId && (
        <SmartSupplierPoWorkspace
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          restaurantId={activeRestaurantId}
          restaurantName={activeRestaurant?.name || 'STOQO Restaurant'}
          currencySymbol={currencySymbol}
          items={items}
          vendors={vendors}
          userUid={user?.uid || 'system'}
          userName={userProfile?.name || user?.displayName || 'Authorized User'}
          userRole={activeRole}
          whatsAppConnected={whatsAppConnected}
          onOrderSentOrUpdated={() => {
            if (statusFilter === 'DRAFT') {
              setStatusFilter('ALL');
            }
          }}
        />
      )}

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
      {/* MODAL 3: WHATSAPP ORDER DISPATCH (ONLY ITEM + QUANTITY + UNIT)       */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={whatsappModal.isOpen}
        onClose={() => setWhatsappModal((prev) => ({ ...prev, isOpen: false }))}
        title="WhatsApp Order"
        subtitle={`Purchase Order ${whatsappModal.po?.poNumber || ''} • ${whatsappModal.po?.vendorName || ''}`}
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs">
          {/* Vendor Details Banner */}
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">Vendor:</span>
              <span className="font-semibold text-stone-900 text-xs">{whatsappModal.po?.vendorName}</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-stone-700 bg-white px-2.5 py-1 rounded-md border border-stone-200 text-xs">
              <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
              <span>{whatsappModal.vendorPhone}</span>
            </div>
          </div>

          {/* Automatic Mode Status Notice */}
          {whatsappModal.isNotConnected ? (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2.5 text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold text-xs text-amber-950">
                  Automatic WhatsApp is not configured. Use Manual WhatsApp.
                </p>
                <p className="text-[11px] text-amber-800">
                  Official WhatsApp Cloud API is not connected. Use <strong>Open in WhatsApp</strong> below to send the order message directly to the vendor from your device.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-start gap-2.5 text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold text-xs text-emerald-950">
                  Official WhatsApp Cloud API Ready
                </p>
                <p className="text-[11px] text-emerald-800">
                  Order message containing only items, quantities, and units will be sent directly to vendor's registered WhatsApp number.
                </p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {whatsappModal.errorMessage && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">WhatsApp Dispatch Error:</p>
                <p className="text-[11px] mt-0.5">{whatsappModal.errorMessage}</p>
              </div>
            </div>
          )}

          {/* Pure Text PO Message Preview (ITEM + QTY + UNIT ONLY • NO PRICES) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                WhatsApp Message (Item + Qty + Unit only)
              </label>
              <span className="text-[10px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                {whatsappModal.po?.items?.length || 0} ITEMS • NO PRICES
              </span>
            </div>

            <div className="p-4 bg-stone-900 text-emerald-400 font-mono text-[11px] rounded-xl border border-stone-800 whitespace-pre overflow-x-auto max-h-72 select-text leading-relaxed shadow-inner">
              {whatsappModal.messageText}
            </div>
            <p className="text-[10px] text-stone-500 italic">
              * Rates, amounts, and totals are strictly excluded from the WhatsApp order.
            </p>
          </div>

          {/* Action Buttons: Cancel, Open in WhatsApp, Send WhatsApp Order */}
          <div className="pt-3 border-t border-stone-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setWhatsappModal((prev) => ({ ...prev, isOpen: false }))}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
            >
              Cancel
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {/* Fallback / Manual Open in WhatsApp */}
              <button
                type="button"
                onClick={handleOpenInWhatsAppManual}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg shadow-2xs transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                Open in WhatsApp
              </button>

              {/* Automatic Mode: Send via Cloud API */}
              {!whatsappModal.isNotConnected && (
                <button
                  type="button"
                  disabled={whatsappModal.isSending}
                  onClick={handleExecuteWhatsAppSend}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs disabled:opacity-50 transition-colors"
                >
                  {whatsappModal.isSending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Sending WhatsApp Order...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Send WhatsApp Order
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
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

      {/* ------------------------------------------------------------------- */}
      {/* MODAL 5: EDIT DRAFT PURCHASE ORDER (TAX-FREE: QTY x RATE = AMOUNT)  */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        isOpen={editPoModal.isOpen}
        onClose={() => setEditPoModal({ isOpen: false, po: null, items: [], isSaving: false, error: null })}
        title={`Edit Purchase Order ${editPoModal.po?.poNumber || ''}`}
        subtitle={`Supplier: ${editPoModal.po?.vendorName || ''} · Line Amount = Quantity × Rate`}
        maxWidth="2xl"
      >
        <form onSubmit={handleSaveEditPo} className="space-y-4">
          {editPoModal.error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{editPoModal.error}</span>
            </div>
          )}

          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs text-stone-600">
                <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-bold text-stone-500 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-2 text-right">Quantity</th>
                    <th className="py-2.5 px-2 text-center">UOM</th>
                    <th className="py-2.5 px-2 text-right">Rate ({currencySymbol})</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-2 text-center">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {editPoModal.items.map((row, idx) => {
                    const lineAmount = Number(((Number(row.orderedQty) || 0) * (Number(row.estimatedRate) || 0)).toFixed(2));
                    return (
                      <tr key={`${row.itemId}-${idx}`} className="hover:bg-stone-50/60">
                        <td className="py-2 px-3 font-medium text-stone-900">{row.itemName}</td>
                        <td className="py-2 px-2 text-right">
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            required
                            value={row.orderedQty}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value) || 0);
                              setEditPoModal((prev) => ({
                                ...prev,
                                items: prev.items.map((it, i) => (i === idx ? { ...it, orderedQty: val } : it)),
                              }));
                            }}
                            className="w-20 px-2 py-1 text-xs border border-stone-300 rounded text-right font-bold"
                          />
                        </td>
                        <td className="py-2 px-2 text-center text-stone-500">{row.unit}</td>
                        <td className="py-2 px-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={row.estimatedRate}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value) || 0);
                              setEditPoModal((prev) => ({
                                ...prev,
                                items: prev.items.map((it, i) => (i === idx ? { ...it, estimatedRate: val } : it)),
                              }));
                            }}
                            className="w-24 px-2 py-1 text-xs border border-stone-300 rounded text-right font-mono font-bold"
                          />
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                          {currencySymbol}{lineAmount.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            disabled={editPoModal.items.length <= 1}
                            onClick={() =>
                              setEditPoModal((prev) => ({
                                ...prev,
                                items: prev.items.filter((_, i) => i !== idx),
                              }))
                            }
                            className="p-1 text-stone-400 hover:text-rose-600 disabled:opacity-30"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(() => {
              const grandTotal = Number(
                editPoModal.items
                  .reduce((sum, r) => sum + Number(((Number(r.orderedQty) || 0) * (Number(r.estimatedRate) || 0)).toFixed(2)), 0)
                  .toFixed(2)
              );
              return (
                <div className="p-3.5 bg-stone-50 border-t border-stone-200 flex flex-col items-end gap-1 text-xs">
                  <div className="flex justify-between w-52 text-stone-600">
                    <span>Subtotal:</span>
                    <span className="font-mono">{currencySymbol}{grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between w-52 text-stone-900 font-bold text-sm pt-1.5 border-t border-stone-200">
                    <span>Grand Total:</span>
                    <span className="font-mono">{currencySymbol}{grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setEditPoModal({ isOpen: false, po: null, items: [], isSaving: false, error: null })}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editPoModal.isSaving}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {editPoModal.isSaving ? 'Saving...' : 'Save Purchase Order'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
