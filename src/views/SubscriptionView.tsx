import React, { useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Sparkles,
  Calendar,
  AlertTriangle,
  Building2,
  Lock,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const SubscriptionView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'MONTHLY' | 'ANNUAL'>('ANNUAL');
  const [processing, setProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sub = activeRestaurant?.subscription || {
    plan: 'TRIAL',
    status: 'trial',
    trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    currentPeriodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
  };

  const isTrial = sub.status === 'trial';
  const trialEndFormatted = sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : 'Active';

  const handleInitiateUpgrade = async () => {
    if (!activeRestaurantId) return;

    try {
      setProcessing(true);
      setErrorMessage(null);
      const res = await fetch('/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: activeRestaurantId,
          plan: selectedPlan,
          amount: selectedPlan === 'ANNUAL' ? 2499900 : 249900,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          data.message ||
          'Payment gateway configuration required (Razorpay keys not set in server environment).'
        );
        return;
      }

      const orderData = await res.json();
      if (!orderData.orderId) {
        setErrorMessage('Invalid order received from payment server.');
        return;
      }

      const Razorpay = (window as any).Razorpay;
      if (!Razorpay) {
        setErrorMessage('Payment gateway configuration required (Razorpay keys not set in server environment).');
        return;
      }

      // Real Razorpay modal if SDK and credentials are live
      const rzp = new Razorpay({
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        name: 'Store Control SaaS',
        description: `${selectedPlan} Restaurant Store Control License`,
        order_id: orderData.orderId,
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch('/api/subscription/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                restaurantId: activeRestaurantId,
                plan: selectedPlan,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            if (!verifyRes.ok) {
              const vErr = await verifyRes.json().catch(() => ({}));
              setErrorMessage(vErr.message || 'Server payment verification rejected.');
              return;
            }

            const periodEndDate = new Date();
            periodEndDate.setDate(periodEndDate.getDate() + (selectedPlan === 'ANNUAL' ? 365 : 30));

            const restRef = doc(db, 'restaurants', activeRestaurantId);
            await updateDoc(restRef, {
              'subscription.plan': selectedPlan,
              'subscription.status': 'active',
              'subscription.currentPeriodEnd': periodEndDate.toISOString(),
            });

            setPaymentSuccess(true);
            setTimeout(() => {
              setIsCheckoutOpen(false);
              setPaymentSuccess(false);
            }, 2000);
          } catch (e: any) {
            setErrorMessage('Payment verification error: ' + (e?.message || 'Verification failed'));
          }
        },
      });

      rzp.open();
    } catch (e: any) {
      setErrorMessage(e?.message || 'Payment gateway configuration required (Razorpay keys not set in server environment).');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Status Card */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">SaaS Subscription & Licensing</h1>
            <Badge variant={sub.status === 'active' ? 'success' : 'warning'} size="sm">
              {sub.status.toUpperCase()}
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Current Tier: <strong className="text-stone-800 font-semibold">{sub.plan}</strong> • Valid through:{' '}
            <strong className="text-stone-800 font-semibold">{trialEndFormatted}</strong>
          </p>
        </div>

        {sub.status !== 'active' && (
          <button
            id="upgrade-sub-btn"
            onClick={() => setIsCheckoutOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Sparkles className="w-4 h-4" /> Upgrade to Commercial License
          </button>
        )}
      </div>

      {/* Pricing Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto pt-4">
        {/* Monthly Plan */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col justify-between shadow-2xs space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-stone-700">Monthly Plan</h3>
              <Badge variant="neutral" size="sm">
                Pay As You Go
              </Badge>
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-3xl font-black text-stone-900">₹2,499</span>
              <span className="text-xs text-stone-500 font-medium">/ month</span>
            </div>
            <p className="text-xs text-stone-500 mt-2">
              Flexible month-to-month control for single restaurant store rooms.
            </p>

            <ul className="space-y-2.5 mt-6 text-xs text-stone-600">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Unlimited Inventory SKUs & Line Items</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Weighted Average Costing Engine</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Purchase Price Guard & Reorder Safeguards</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Department Staff Accountability Register</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Petpooja / eZee POS Integration</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => {
              setSelectedPlan('MONTHLY');
              setIsCheckoutOpen(true);
            }}
            className="w-full py-2.5 px-4 rounded-lg border border-stone-300 hover:bg-stone-50 text-stone-800 text-xs font-bold transition-colors"
          >
            Select Monthly License
          </button>
        </div>

        {/* Annual Plan */}
        <div className="bg-stone-950 text-white rounded-xl border border-stone-800 p-6 flex flex-col justify-between shadow-lg relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 bg-amber-500 text-stone-950 font-black text-[10px] uppercase px-3 py-1 rounded-bl-lg">
            2 Months Free
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400">Annual Commercial</h3>
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-3xl font-black text-white">₹24,999</span>
              <span className="text-xs text-stone-400 font-medium">/ year</span>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              Dedicated store peace of mind with 12 months full audit trail and priority support.
            </p>

            <ul className="space-y-2.5 mt-6 text-xs text-stone-300">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>All Features in Monthly Plan</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>AI Grounded Store Analyst & Daily Briefings</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Multi-User Roles (Storekeeper, Staff, Manager)</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Automated 15-Day Purchase Order Dispatches</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Priority Phone & On-call Store Support</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => {
              setSelectedPlan('ANNUAL');
              setIsCheckoutOpen(true);
            }}
            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold transition-colors shadow-sm"
          >
            Activate Annual License
          </button>
        </div>
      </div>

      {/* Checkout Modal */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title="Commercial SaaS Licensing"
        subtitle={`Activating ${selectedPlan === 'ANNUAL' ? 'Annual (₹24,999)' : 'Monthly (₹2,499)'} Plan`}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-stone-600">Restaurant Tenant:</span>
              <span className="font-bold text-stone-900">{activeRestaurant?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">License Term:</span>
              <span className="font-bold text-stone-900">{selectedPlan}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-stone-200">
              <span className="text-stone-900 font-bold">Total Payable:</span>
              <span className="text-sm font-black text-stone-900">
                {selectedPlan === 'ANNUAL' ? '₹24,999' : '₹2,499'}
              </span>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Payment Gateway Notice: </span>
                {errorMessage}
              </div>
            </div>
          )}

          {paymentSuccess ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold text-center">
              ✓ License successfully updated in Firebase! Refreshing...
            </div>
          ) : (
            <button
              id="confirm-upgrade-pay-btn"
              onClick={handleInitiateUpgrade}
              disabled={processing}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
            >
              {processing ? 'Processing License Upgrade...' : 'Proceed to Secure Payment'}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
};
