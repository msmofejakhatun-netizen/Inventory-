import React, { useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  Phone,
  CreditCard,
  Download,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Edit2,
  Receipt,
  FileText,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Vendor, VendorPayment, Purchase, PaymentMode } from '../types';
import { executeVendorPaymentTransaction, reconcilePaymentWithPurchase } from '../services/restaurantService';
import { getPurchasePaymentInfo } from '../services/calculations';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const VendorsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<'VENDORS' | 'PAYMENTS'>('VENDORS');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Vendor Modal
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [address, setAddress] = useState('');
  const [openingDue, setOpeningDue] = useState(0);

  // Record Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentVendor, setPaymentVendor] = useState<Vendor | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>('NONE');
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);

  // Reconcile unlinked payment voucher modal
  const [reconcilingPayment, setReconcilingPayment] = useState<VendorPayment | null>(null);
  const [reconcileTargetPurchaseId, setReconcileTargetPurchaseId] = useState<string>('');
  const [submittingReconcile, setSubmittingReconcile] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
      setLoading(false);
    });

    const unsubPayments = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'vendorPayments'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setPayments(snap.docs.map((d) => d.data() as VendorPayment));
      }
    );

    const unsubPurchases = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'purchases'), orderBy('createdAt', 'desc'), limit(100)),
      (snap) => {
        setPurchases(snap.docs.map((d) => d.data() as Purchase));
      }
    );

    return () => {
      unsubVendors();
      unsubPayments();
      unsubPurchases();
    };
  }, [activeRestaurantId]);

  const openAddVendorModal = () => {
    setEditingVendor(null);
    setName('');
    setContactPerson('');
    setPhone('');
    setEmail('');
    setGstNumber('');
    setAddress('');
    setOpeningDue(0);
    setIsVendorModalOpen(true);
  };

  const openEditVendorModal = (v: Vendor) => {
    setEditingVendor(v);
    setName(v.name);
    setContactPerson(v.contactPerson || '');
    setPhone(v.phone || '');
    setEmail(v.email || '');
    setGstNumber(v.gstNumber || '');
    setAddress(v.address || '');
    setOpeningDue(v.currentDue || 0);
    setIsVendorModalOpen(true);
  };

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !name.trim()) return;

    const now = new Date().toISOString();

    if (editingVendor) {
      const vRef = doc(db, 'restaurants', activeRestaurantId, 'vendors', editingVendor.id);
      await updateDoc(vRef, {
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gstNumber: gstNumber.trim(),
        address: address.trim(),
        updatedAt: now,
      });
    } else {
      const vRef = doc(collection(db, 'restaurants', activeRestaurantId, 'vendors'));
      const newV: Vendor = {
        id: vRef.id,
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        phone: phone.trim(),
        mobile: phone.trim(),
        email: email.trim(),
        gstNumber: gstNumber.trim(),
        taxNumber: gstNumber.trim(),
        address: address.trim(),
        creditDays: 30,
        openingDue: Number(openingDue) || 0,
        totalPurchases: 0,
        totalPaid: 0,
        currentDue: Number(openingDue) || 0,
        restaurantId: activeRestaurantId,
        createdAt: now,
      };
      await setDoc(vRef, newV);
    }

    setIsVendorModalOpen(false);
  };

  const openPaymentModal = (v: Vendor, defaultPurchaseId?: string) => {
    setPaymentVendor(v);
    const vendorBills = purchases.filter((p) => p.vendorId === v.id);
    const unpaidBills = vendorBills.filter((p) => getPurchasePaymentInfo(p).status !== 'PAID');

    if (defaultPurchaseId) {
      const target = vendorBills.find((p) => p.id === defaultPurchaseId);
      if (target) {
        setSelectedPurchaseId(target.id);
        setAmountPaid(getPurchasePaymentInfo(target).remainingAmount);
      } else {
        setSelectedPurchaseId('NONE');
        setAmountPaid(v.currentDue > 0 ? v.currentDue : 0);
      }
    } else if (unpaidBills.length > 0) {
      setSelectedPurchaseId(unpaidBills[0].id);
      setAmountPaid(getPurchasePaymentInfo(unpaidBills[0]).remainingAmount);
    } else {
      setSelectedPurchaseId('NONE');
      setAmountPaid(v.currentDue > 0 ? v.currentDue : 0);
    }

    setPaymentMode('BANK_TRANSFER');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReferenceNumber('');
    setNotes('');
    setPaymentFormError(null);
    setIsPaymentModalOpen(true);
  };

  const handlePurchaseSelectChange = (purchaseId: string) => {
    setSelectedPurchaseId(purchaseId);
    setPaymentFormError(null);
    if (purchaseId !== 'NONE') {
      const target = purchases.find((p) => p.id === purchaseId);
      if (target) {
        const payInfo = getPurchasePaymentInfo(target);
        setAmountPaid(payInfo.remainingAmount);
      }
    } else if (paymentVendor) {
      setAmountPaid(paymentVendor.currentDue > 0 ? paymentVendor.currentDue : 0);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !paymentVendor) return;

    const amount = Number(amountPaid);
    if (amount <= 0) {
      setPaymentFormError('Payment amount must be greater than zero.');
      return;
    }

    let targetPurchase: Purchase | undefined;
    if (selectedPurchaseId !== 'NONE') {
      targetPurchase = purchases.find((p) => p.id === selectedPurchaseId);
      if (targetPurchase) {
        const payInfo = getPurchasePaymentInfo(targetPurchase);
        if (amount > payInfo.remainingAmount + 0.01) {
          setPaymentFormError(
            `Payment amount (${currencySymbol}${amount.toFixed(2)}) cannot exceed remaining invoice due of ${currencySymbol}${payInfo.remainingAmount.toFixed(2)}.`
          );
          return;
        }
      }
    }

    try {
      setSubmittingPayment(true);
      setPaymentFormError(null);

      await executeVendorPaymentTransaction(activeRestaurantId, {
        vendorId: paymentVendor.id,
        vendorName: paymentVendor.name,
        purchaseId: targetPurchase ? targetPurchase.id : undefined,
        billNumber: targetPurchase ? targetPurchase.billNumber : undefined,
        amount,
        paymentMode,
        paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
        reference: referenceNumber.trim(),
        notes: notes.trim(),
        recordedByUid: user?.uid || 'staff',
        recordedByName: userProfile?.name || user?.displayName || 'Staff',
      });

      setIsPaymentModalOpen(false);
    } catch (err: any) {
      console.error('Payment error:', err);
      setPaymentFormError(err?.message || 'Payment transaction failed');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const openReconcileModal = (payment: VendorPayment) => {
    setReconcilingPayment(payment);
    const vendorBills = purchases.filter((p) => p.vendorId === payment.vendorId);
    const unpaidBills = vendorBills.filter((p) => getPurchasePaymentInfo(p).status !== 'PAID');
    setReconcileTargetPurchaseId(unpaidBills[0]?.id || '');
    setReconcileError(null);
  };

  const handleConfirmReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !reconcilingPayment || !reconcileTargetPurchaseId) return;

    try {
      setSubmittingReconcile(true);
      setReconcileError(null);

      await reconcilePaymentWithPurchase(activeRestaurantId, {
        paymentId: reconcilingPayment.id,
        purchaseId: reconcileTargetPurchaseId,
        recordedByUid: user?.uid || 'staff',
        recordedByName: userProfile?.name || user?.displayName || 'Staff',
      });

      setReconcilingPayment(null);
    } catch (err: any) {
      console.error('Reconciliation error:', err);
      setReconcileError(err?.message || 'Failed to reconcile payment with invoice.');
    } finally {
      setSubmittingReconcile(false);
    }
  };

  const filteredVendors = vendors.filter((v) => {
    return (
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.contactPerson && v.contactPerson.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (v.phone && v.phone.includes(searchQuery))
    );
  });

  const filteredPayments = payments.filter((p) => {
    return (
      p.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.billNumber && p.billNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.reference && p.reference.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.notes && p.notes.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const totalOutstandingDue = vendors.reduce((sum, v) => sum + (Number(v.currentDue) || 0), 0);
  const totalPaymentsDisbursed = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const handleExportCsv = () => {
    if (activeTab === 'VENDORS') {
      const headers = ['Vendor Name', 'Contact Person', 'Phone', 'GST', 'Current Due'];
      const rows = filteredVendors.map((v) => [v.name, v.contactPerson, v.phone, v.gstNumber, v.currentDue]);
      exportToCsv(`vendor_dues_${activeRestaurant?.name || 'store'}`, headers, rows);
    } else {
      const headers = ['Date', 'Vendor', 'Bill Number', 'Payment Mode', 'Reference', 'Amount Paid', 'Recorded By'];
      const rows = filteredPayments.map((p) => [
        p.paymentDate || p.createdAt.slice(0, 10),
        p.vendorName,
        p.billNumber || 'General Account',
        p.paymentMode,
        p.reference || '-',
        p.amount,
        p.recordedByName,
      ]);
      exportToCsv(`payment_vouchers_${activeRestaurant?.name || 'store'}`, headers, rows);
    }
  };

  const handleExportPdf = () => {
    if (activeTab === 'VENDORS') {
      const headers = ['Vendor Name', 'Contact', 'Phone', 'GST #', 'Current Due'];
      const rows = filteredVendors.map((v) => [
        v.name,
        v.contactPerson,
        v.phone,
        v.gstNumber,
        `${currencySymbol}${v.currentDue.toFixed(2)}`,
      ]);
      exportToPdf('Vendor Outstanding Dues Ledger', activeRestaurant?.name || 'Store', headers, rows);
    } else {
      const headers = ['Date', 'Vendor', 'Bill #', 'Mode', 'Ref #', 'Amount'];
      const rows = filteredPayments.map((p) => [
        p.paymentDate || p.createdAt.slice(0, 10),
        p.vendorName,
        p.billNumber || 'General',
        p.paymentMode,
        p.reference || '-',
        `${currencySymbol}${p.amount.toFixed(2)}`,
      ]);
      exportToPdf('Vendor Payment Vouchers Ledger', activeRestaurant?.name || 'Store', headers, rows);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">Vendor & Supplier Ledger</h1>
            <Badge variant="neutral" size="sm">
              {vendors.length} Registered Suppliers
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Supplier directory, outstanding payables, invoice ledger, and payment voucher dispatches.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="add-vendor-btn"
            onClick={openAddVendorModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
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

      {/* Tabs Switcher */}
      <div className="flex border-b border-stone-200 gap-6 text-xs font-bold">
        <button
          onClick={() => setActiveTab('VENDORS')}
          className={`pb-3 flex items-center gap-1.5 transition-colors border-b-2 -mb-px ${
            activeTab === 'VENDORS'
              ? 'border-amber-600 text-amber-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Vendor Directory & Balances</span>
          <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[10px]">
            {vendors.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('PAYMENTS')}
          className={`pb-3 flex items-center gap-1.5 transition-colors border-b-2 -mb-px ${
            activeTab === 'PAYMENTS'
              ? 'border-amber-600 text-amber-700'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Payment Vouchers & Settlement Ledger</span>
          <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[10px]">
            {payments.length}
          </span>
        </button>
      </div>

      {/* Summary Banner & Search */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="vendor-search-input"
            type="text"
            placeholder={
              activeTab === 'VENDORS'
                ? 'Search vendor name, contact person, or phone...'
                : 'Search payment vouchers by vendor, bill #, reference, or notes...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        {activeTab === 'VENDORS' ? (
          <div className="text-xs text-stone-600 font-medium whitespace-nowrap">
            Total Outstanding Payables:{' '}
            <span className="font-bold text-rose-700 text-sm">
              {currencySymbol}{totalOutstandingDue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
        ) : (
          <div className="text-xs text-stone-600 font-medium whitespace-nowrap">
            Total Vouchers Disbursed:{' '}
            <span className="font-bold text-emerald-700 text-sm">
              {currencySymbol}{totalPaymentsDisbursed.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* Tab 1: Vendors Table */}
      {activeTab === 'VENDORS' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Vendor Name</th>
                  <th className="py-3 px-4">Contact Person</th>
                  <th className="py-3 px-4">Phone / Email</th>
                  <th className="py-3 px-4">GST Number</th>
                  <th className="py-3 px-4 text-right">Current Outstanding Due</th>
                  <th className="py-3 px-4 text-center">Record Payment</th>
                  <th className="py-3 px-4 text-center">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-stone-400">
                      Loading vendors...
                    </td>
                  </tr>
                ) : filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-stone-400">
                      No vendors registered yet.
                    </td>
                  </tr>
                ) : (
                  filteredVendors.map((v) => (
                    <tr key={v.id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-stone-900">{v.name}</td>
                      <td className="py-3 px-4 text-stone-700">{v.contactPerson || '-'}</td>
                      <td className="py-3 px-4 text-stone-500">
                        <div>{v.phone || '-'}</div>
                        <div className="text-[10px] text-stone-400">{v.email}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-stone-600 text-[11px]">{v.gstNumber || '-'}</td>
                      <td className="py-3 px-4 text-right font-bold text-sm">
                        <span className={v.currentDue > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          {currencySymbol}{v.currentDue.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          id={`pay-vendor-${v.id}`}
                          onClick={() => openPaymentModal(v)}
                          className="px-2.5 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded text-[11px] font-semibold transition-colors"
                        >
                          Record Payment
                        </button>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => openEditVendorModal(v)}
                          className="p-1 text-stone-400 hover:text-stone-700 rounded"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Payments Vouchers Ledger */}
      {activeTab === 'PAYMENTS' && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Vendor</th>
                  <th className="py-3 px-4">Linked Invoice / Bill</th>
                  <th className="py-3 px-4">Payment Mode</th>
                  <th className="py-3 px-4">Reference #</th>
                  <th className="py-3 px-4 text-right">Amount Paid</th>
                  <th className="py-3 px-4">Recorded By</th>
                  <th className="py-3 px-4 text-right">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-stone-400">
                      No payment vouchers recorded yet.
                    </td>
                  </tr>
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-stone-400">
                      No payment vouchers match search filter.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => {
                    const isLinked = !!p.purchaseId;
                    const vendorUnpaidBills = purchases.filter(
                      (purch) => purch.vendorId === p.vendorId && getPurchasePaymentInfo(purch).status !== 'PAID'
                    );
                    const canReconcile = !isLinked && vendorUnpaidBills.length > 0;

                    return (
                      <tr key={p.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-3 px-4 text-stone-700 font-mono">
                          {p.paymentDate || p.createdAt.slice(0, 10)}
                        </td>
                        <td className="py-3 px-4 font-bold text-stone-900">{p.vendorName}</td>
                        <td className="py-3 px-4">
                          {isLinked ? (
                            <div className="flex items-center gap-1 font-mono text-emerald-700 font-bold">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Bill #{p.billNumber}</span>
                            </div>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              General Account
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 font-semibold text-stone-700">{p.paymentMode}</td>
                        <td className="py-3 px-4 font-mono text-stone-500 text-[11px]">{p.reference || '-'}</td>
                        <td className="py-3 px-4 text-right font-bold text-stone-900 font-mono text-sm">
                          {currencySymbol}{p.amount.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-stone-500 text-[11px]">{p.recordedByName}</td>
                        <td className="py-3 px-4 text-right">
                          {isLinked ? (
                            <span className="text-[11px] text-emerald-700 font-semibold">Settled</span>
                          ) : canReconcile ? (
                            <button
                              onClick={() => openReconcileModal(p)}
                              className="px-2 py-1 text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 rounded border border-amber-200 transition-colors"
                            >
                              Link to Bill
                            </button>
                          ) : (
                            <span className="text-[11px] text-stone-400">Account Credit</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Vendor Modal */}
      <Modal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        title={editingVendor ? 'Edit Vendor Details' : 'Add New Vendor / Supplier'}
        subtitle="Maintain vendor GST credentials, phone, and opening payable balance"
        maxWidth="lg"
      >
        <form onSubmit={handleSaveVendor} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Vendor / Business Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Metro Dairy Supply Co."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 font-semibold"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Contact Person
              </label>
              <input
                type="text"
                placeholder="e.g. Rajesh Kumar"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Phone Number
              </label>
              <input
                type="text"
                placeholder="e.g. +91 98200 12345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                GST Number
              </label>
              <input
                type="text"
                placeholder="e.g. 27AAAAA0000A1Z5"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                placeholder="orders@metrodairy.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {!editingVendor && (
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Opening Balance Due ({currencySymbol})
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={openingDue}
                onChange={(e) => setOpeningDue(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
              />
            </div>
          )}

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsVendorModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              id="save-vendor-submit-btn"
              type="submit"
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              {editingVendor ? 'Update Vendor' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title={`Record Payment to ${paymentVendor?.name}`}
        subtitle={`Current total outstanding balance: ${currencySymbol}${paymentVendor?.currentDue.toFixed(2)}`}
        maxWidth="lg"
      >
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          {paymentFormError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-800 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{paymentFormError}</span>
            </div>
          )}

          {/* Allocation Selector */}
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Apply Payment Towards *
            </label>
            <select
              value={selectedPurchaseId}
              onChange={(e) => handlePurchaseSelectChange(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white font-medium text-stone-900 focus:outline-none focus:border-amber-500"
            >
              <option value="NONE">General Account Credit / Unallocated</option>
              {paymentVendor &&
                purchases
                  .filter((p) => p.vendorId === paymentVendor.id)
                  .map((p) => {
                    const payInfo = getPurchasePaymentInfo(p);
                    return (
                      <option key={p.id} value={p.id}>
                        Bill #{p.billNumber} ({p.billDate}) — Total: {currencySymbol}
                        {p.netAmount.toFixed(2)} | Due: {currencySymbol}
                        {payInfo.remainingAmount.toFixed(2)} [{payInfo.displayStatus}]
                      </option>
                    );
                  })}
            </select>
          </div>

          {/* If invoice selected, show live invoice payment summary cards */}
          {selectedPurchaseId !== 'NONE' && (() => {
            const target = purchases.find((p) => p.id === selectedPurchaseId);
            if (!target) return null;
            const payInfo = getPurchasePaymentInfo(target);
            const remainingAfter = Math.max(0, payInfo.remainingAmount - (Number(amountPaid) || 0));
            const willBePaidInFull = (Number(amountPaid) || 0) >= payInfo.remainingAmount - 0.01;

            return (
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-stone-700">
                    Bill #{target.billNumber} ({target.billDate})
                  </span>
                  <Badge variant={payInfo.badgeVariant} size="sm">
                    Current: {payInfo.displayStatus}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 bg-white rounded-lg border border-stone-200">
                    <div className="text-[10px] text-stone-500 font-semibold uppercase">Total Bill</div>
                    <div className="font-bold text-stone-900 mt-0.5">
                      {currencySymbol}{target.netAmount.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-stone-200">
                    <div className="text-[10px] text-stone-500 font-semibold uppercase">Already Paid</div>
                    <div className="font-bold text-emerald-700 mt-0.5">
                      {currencySymbol}{payInfo.paidAmount.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-rose-200">
                    <div className="text-[10px] text-rose-600 font-semibold uppercase">Remaining Due</div>
                    <div className="font-bold text-rose-700 mt-0.5">
                      {currencySymbol}{payInfo.remainingAmount.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-stone-200 text-stone-600 font-medium">
                  <span>Balance after this payment:</span>
                  <span className={`font-bold font-mono ${remainingAfter <= 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {currencySymbol}{remainingAfter.toFixed(2)} {willBePaidInFull && '✓ (Will mark PAID)'}
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Payment Amount ({currencySymbol}) *
              </label>
              <input
                id="vendor-payment-amount-input"
                type="number"
                min={0.01}
                step="any"
                required
                value={amountPaid}
                onChange={(e) => {
                  setAmountPaid(Number(e.target.value));
                  setPaymentFormError(null);
                }}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-bold text-stone-900 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Payment Date *
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Payment Mode
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
              >
                <option value="BANK_TRANSFER">Bank NEFT / RTGS</option>
                <option value="UPI">UPI / GPay / PhonePe</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CARD">Debit / Credit Card</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
                Transaction / Cheque Reference #
              </label>
              <input
                type="text"
                placeholder="e.g. UTR-9988221 / CHQ-10492"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-mono focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Payment Notes
            </label>
            <input
              type="text"
              placeholder="e.g. Settling Bill #90 in full via NEFT"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsPaymentModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              id="confirm-payment-btn"
              type="submit"
              disabled={submittingPayment}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submittingPayment ? 'Processing...' : 'Confirm Payment Voucher'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reconcile Unlinked Payment Modal */}
      <Modal
        isOpen={!!reconcilingPayment}
        onClose={() => setReconcilingPayment(null)}
        title="Link Payment Voucher to Purchase Invoice"
        subtitle={
          reconcilingPayment
            ? `Voucher for ${currencySymbol}${reconcilingPayment.amount.toFixed(2)} (${reconcilingPayment.vendorName}) on ${reconcilingPayment.paymentDate || reconcilingPayment.createdAt.slice(0, 10)}`
            : ''
        }
        maxWidth="md"
      >
        <form onSubmit={handleConfirmReconcile} className="space-y-4">
          {reconcileError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-800 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{reconcileError}</span>
            </div>
          )}

          <p className="text-xs text-stone-600">
            Select the purchase invoice that was settled by this voucher. This will update the invoice's paid amount and payment status atomically.
          </p>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Select Purchase Invoice *
            </label>
            <select
              value={reconcileTargetPurchaseId}
              onChange={(e) => setReconcileTargetPurchaseId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white font-medium"
              required
            >
              <option value="">-- Choose Invoice --</option>
              {reconcilingPayment &&
                purchases
                  .filter((p) => p.vendorId === reconcilingPayment.vendorId)
                  .map((p) => {
                    const payInfo = getPurchasePaymentInfo(p);
                    return (
                      <option key={p.id} value={p.id}>
                        Bill #{p.billNumber} ({p.billDate}) — Total: {currencySymbol}
                        {p.netAmount.toFixed(2)} | Due: {currencySymbol}
                        {payInfo.remainingAmount.toFixed(2)} [{payInfo.displayStatus}]
                      </option>
                    );
                  })}
            </select>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setReconcilingPayment(null)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingReconcile || !reconcileTargetPurchaseId}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50"
            >
              {submittingReconcile ? 'Linking...' : 'Reconcile & Update Invoice'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
