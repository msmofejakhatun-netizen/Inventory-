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
} from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Vendor, VendorPayment } from '../types';
import { executeVendorPaymentTransaction } from '../services/restaurantService';
import { exportToCsv, exportToPdf } from '../services/exportService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const VendorsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
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
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentMode, setPaymentMode] = useState<VendorPayment['paymentMode']>('BANK_TRANSFER');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (snap) => {
      setVendors(snap.docs.map((d) => d.data() as Vendor));
      setLoading(false);
    });

    const unsubPayments = onSnapshot(
      query(collection(db, 'restaurants', activeRestaurantId, 'vendorPayments'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        setPayments(snap.docs.map((d) => d.data() as VendorPayment));
      }
    );

    return () => {
      unsubVendors();
      unsubPayments();
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

  const openPaymentModal = (v: Vendor) => {
    setPaymentVendor(v);
    setAmountPaid(v.currentDue > 0 ? v.currentDue : 0);
    setPaymentMode('BANK_TRANSFER');
    setReferenceNumber('');
    setNotes('');
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !paymentVendor || amountPaid <= 0) return;

    try {
      setSubmittingPayment(true);
      await executeVendorPaymentTransaction(activeRestaurantId, {
        vendorId: paymentVendor.id,
        vendorName: paymentVendor.name,
        amount: Number(amountPaid),
        paymentMode,
        reference: referenceNumber.trim(),
        recordedByUid: user?.uid || 'staff',
        recordedByName: userProfile?.name || 'Staff',
      });

      setIsPaymentModalOpen(false);
    } catch (err) {
      console.error('Payment error:', err);
    } finally {
      setSubmittingPayment(false);
    }
  };

  const filteredVendors = vendors.filter((v) => {
    return (
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.contactPerson && v.contactPerson.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (v.phone && v.phone.includes(searchQuery))
    );
  });

  const totalOutstandingDue = vendors.reduce((sum, v) => sum + (Number(v.currentDue) || 0), 0);

  const handleExportCsv = () => {
    const headers = ['Vendor Name', 'Contact Person', 'Phone', 'GST', 'Current Due'];
    const rows = filteredVendors.map((v) => [v.name, v.contactPerson, v.phone, v.gstNumber, v.currentDue]);
    exportToCsv(`vendor_dues_${activeRestaurant?.name || 'store'}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Vendor Name', 'Contact', 'Phone', 'GST #', 'Current Due'];
    const rows = filteredVendors.map((v) => [
      v.name,
      v.contactPerson,
      v.phone,
      v.gstNumber,
      `${currencySymbol}${v.currentDue.toFixed(2)}`,
    ]);
    exportToPdf('Vendor Outstanding Dues Ledger', activeRestaurant?.name || 'Store', headers, rows);
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

      {/* Summary Banner & Search */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
          <input
            id="vendor-search-input"
            type="text"
            placeholder="Search vendor name, contact person, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="text-xs text-stone-600 font-medium whitespace-nowrap">
          Total Outstanding Payables:{' '}
          <span className="font-bold text-rose-700 text-sm">
            {currencySymbol}{totalOutstandingDue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Vendors Table */}
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
                        onClick={() => openPaymentModal(v)}
                        className="px-2.5 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded text-[11px] font-semibold"
                      >
                        Pay Due
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
        subtitle={`Current outstanding balance: ${currencySymbol}${paymentVendor?.currentDue.toFixed(2)}`}
        maxWidth="md"
      >
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Amount Paid ({currencySymbol}) *
            </label>
            <input
              type="number"
              min={0.01}
              step="any"
              required
              value={amountPaid}
              onChange={(e) => setAmountPaid(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg font-bold text-stone-900 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Payment Mode
            </label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as any)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
            >
              <option value="BANK_TRANSFER">Bank NEFT / RTGS</option>
              <option value="UPI">UPI / GPay / PhonePe</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
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

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Payment Notes
            </label>
            <input
              type="text"
              placeholder="e.g. Partial clearing of bill INV-88219"
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
    </div>
  );
};
