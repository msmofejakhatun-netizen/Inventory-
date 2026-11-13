import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Info,
  Clock,
  XCircle,
} from 'lucide-react';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import { StoqoLogo } from '../components/brand/StoqoLogo';
import { Subscription } from '../types';
import { logAuditEvent } from '../services/restaurantService';

const STOQO_PRO_PRICE_INR = 799;
const STOQO_PRO_AMOUNT_PAISE = 79900;
const STOQO_PRO_CURRENCY = 'INR';

type LifecycleStatus = 'TRIAL' | 'ACTIVE' | 'PENDING' | 'PAYMENT_FAILED' | 'CANCELLED' | 'EXPIRED';

function normalizeLifecycleStatus(rawStatus?: string, periodEndIso?: string): LifecycleStatus {
  const s = (rawStatus || 'trialing').toUpperCase();
  if (periodEndIso && new Date(periodEndIso).getTime() < Date.now()) {
    if (s === 'ACTIVE' || s === 'TRIALING' || s === 'TRIAL') {
      return 'EXPIRED';
    }
  }
  if (s === 'ACTIVE') return 'ACTIVE';
  if (s === 'PENDING') return 'PENDING';
  if (s === 'PAYMENT_FAILED' || s === 'PAST_DUE') return 'PAYMENT_FAILED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'EXPIRED') return 'EXPIRED';
  return 'TRIAL';
}

export const SubscriptionView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile } = useAuth();

  const [subscriptionDoc, setSubscriptionDoc] = useState<Subscription | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<{
    gatewayConfigured: boolean;
    recurringPlanConfigured: boolean;
    razorpayPlanId: string | null;
  } | null>(null);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [verifiedPaymentData, setVerifiedPaymentData] = useState<{
    paymentId: string;
    orderId?: string | null;
    subscriptionId?: string | null;
    amount: number;
    amountInPaise: number;
    currency: string;
    currentPeriodEnd: string;
    verifiedAt: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);

  // Listen to real Firestore subscription document at restaurants/{restaurantId}/subscriptions/current
  useEffect(() => {
    if (!activeRestaurantId) {
      setSubscriptionDoc(null);
      return;
    }

    const subRef = doc(db, 'restaurants', activeRestaurantId, 'subscriptions', 'current');
    const unsubscribe = onSnapshot(
      subRef,
      (snap) => {
        if (snap.exists()) {
          setSubscriptionDoc(snap.data() as Subscription);
        } else {
          setSubscriptionDoc(null);
        }
      },
      (err) => {
        console.warn('Subscription listener warning:', err);
      }
    );

    return () => unsubscribe();
  }, [activeRestaurantId]);

  // Fetch server-side payment gateway readiness
  useEffect(() => {
    fetch('/api/subscription/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setGatewayStatus({
            gatewayConfigured: Boolean(data.gatewayConfigured),
            recurringPlanConfigured: Boolean(data.recurringPlanConfigured),
            razorpayPlanId: data.razorpayPlanId || null,
          });
        }
      })
      .catch(() => {
        // Non-fatal
      });
  }, []);

  // Merge subscription state from subcollection or restaurant fallback without deleting or resetting existing records
  const legacySub = (activeRestaurant as any)?.subscription;
  const rawStatus = subscriptionDoc?.status || legacySub?.status || 'trialing';
  const periodEndIso =
    subscriptionDoc?.currentPeriodEnd ||
    subscriptionDoc?.trialEndDate ||
    legacySub?.currentPeriodEnd ||
    legacySub?.trialEndsAt ||
    new Date(Date.now() + 14 * 86400000).toISOString();

  const lifecycleStatus = normalizeLifecycleStatus(rawStatus, periodEndIso);
  const existingAmount = subscriptionDoc?.amount ?? legacySub?.amount ?? STOQO_PRO_PRICE_INR;
  const isLegacyCustomerPricing =
    Boolean(subscriptionDoc || legacySub) &&
    existingAmount !== STOQO_PRO_PRICE_INR &&
    (lifecycleStatus === 'ACTIVE' || lifecycleStatus === 'TRIAL');

  const formattedRenewalDate = periodEndIso
    ? new Date(periodEndIso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Active';

  const statusBadgeVariant = (status: LifecycleStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'TRIAL':
      case 'PENDING':
        return 'warning';
      case 'PAYMENT_FAILED':
      case 'EXPIRED':
        return 'danger';
      case 'CANCELLED':
      default:
        return 'neutral';
    }
  };

  const persistSubscriptionStatusChange = async (
    newStatus: Subscription['status'],
    extraFields: Record<string, any> = {}
  ) => {
    if (!activeRestaurantId) return;
    const nowIso = new Date().toISOString();
    try {
      const subRef = doc(db, 'restaurants', activeRestaurantId, 'subscriptions', 'current');
      await setDoc(
        subRef,
        {
          id: 'current',
          restaurantId: activeRestaurantId,
          status: newStatus,
          updatedAt: nowIso,
          ...extraFields,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Could not update subscription subcollection:', err);
    }
  };

  const handleOpenCheckout = () => {
    setErrorMessage(null);
    setPaymentSuccess(false);
    setVerifiedPaymentData(null);
    setConsentGiven(!isLegacyCustomerPricing);
    setIsCheckoutOpen(true);
  };

  const handleInitiateUpgrade = async () => {
    if (!activeRestaurantId) return;
    if (isLegacyCustomerPricing && !consentGiven) {
      setErrorMessage('Please confirm and consent to the updated ₹799/month renewal pricing before proceeding.');
      return;
    }

    try {
      setProcessing(true);
      setErrorMessage(null);

      // Mark status as PENDING while payment order is initiated
      await persistSubscriptionStatusChange('PENDING');

      // Backend strictly enforces ₹799 (79900 paise, INR) and never trusts client amount
      const res = await fetch('/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: activeRestaurantId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(
          data.message ||
            'Payment gateway configuration required (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET not set in server environment).'
        );
        return;
      }

      const orderData = await res.json();
      if (!orderData.orderId && !orderData.subscriptionId) {
        setErrorMessage('Invalid payment session received from server.');
        return;
      }

      const Razorpay = (window as any).Razorpay;
      if (!Razorpay) {
        setErrorMessage(
          'Razorpay Checkout SDK is not loaded or payment gateway credentials are not configured in server environment.'
        );
        return;
      }

      const rzpOptions: Record<string, any> = {
        key: orderData.keyId,
        amount: STOQO_PRO_AMOUNT_PAISE, // 79900 paise (server-verified)
        currency: STOQO_PRO_CURRENCY, // INR
        name: 'STOQO',
        description: 'STOQO PROFESSIONAL — ₹799 / month',
        ...(orderData.subscriptionId
          ? { subscription_id: orderData.subscriptionId }
          : { order_id: orderData.orderId }),
        prefill: {
          name: userProfile?.name || user?.displayName || '',
          email: user?.email || '',
          contact: user?.phoneNumber || userProfile?.phone || '',
        },
        modal: {
          ondismiss: () => {
            setProcessing(false);
          },
        },
        handler: async (response: any) => {
          try {
            setProcessing(true);
            const verifyRes = await fetch('/api/subscription/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                restaurantId: activeRestaurantId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json().catch(() => ({}));

            if (!verifyRes.ok || !verifyData.verified) {
              await persistSubscriptionStatusChange('PAYMENT_FAILED', {
                lastError: verifyData.error || 'Payment verification rejected by backend.',
              });
              setErrorMessage(verifyData.error || 'Server payment verification rejected.');
              return;
            }

            const nowIso = verifyData.currentPeriodStart || new Date().toISOString();
            const periodEndIsoVerified =
              verifyData.currentPeriodEnd ||
              new Date(Date.now() + 30 * 86400000).toISOString();

            // Update subscription document only after verified backend payment
            const subRef = doc(db, 'restaurants', activeRestaurantId, 'subscriptions', 'current');
            await setDoc(
              subRef,
              {
                id: 'current',
                restaurantId: activeRestaurantId,
                planId: 'stoqo_professional_monthly_799',
                planName: 'STOQO PROFESSIONAL',
                status: 'ACTIVE',
                currentPeriodStart: nowIso,
                currentPeriodEnd: periodEndIsoVerified,
                cancelAtPeriodEnd: false,
                amount: STOQO_PRO_PRICE_INR,
                amountInPaise: STOQO_PRO_AMOUNT_PAISE,
                currency: STOQO_PRO_CURRENCY,
                billingCycle: 'MONTHLY',
                razorpayPaymentId: verifyData.paymentId,
                razorpayOrderId: verifyData.orderId || null,
                razorpaySubscriptionId: verifyData.subscriptionId || null,
                lastVerifiedPaymentAt: verifyData.verifiedAt || nowIso,
                renewalNoticeAccepted: true,
                updatedAt: nowIso,
              },
              { merge: true }
            );

            // Also sync summary fields on restaurant document for compatibility
            const restRef = doc(db, 'restaurants', activeRestaurantId);
            await updateDoc(restRef, {
              'subscription.plan': 'STOQO PROFESSIONAL',
              'subscription.planId': 'stoqo_professional_monthly_799',
              'subscription.status': 'ACTIVE',
              'subscription.amount': STOQO_PRO_PRICE_INR,
              'subscription.amountInPaise': STOQO_PRO_AMOUNT_PAISE,
              'subscription.currency': STOQO_PRO_CURRENCY,
              'subscription.billingCycle': 'MONTHLY',
              'subscription.currentPeriodEnd': periodEndIsoVerified,
            });

            await logAuditEvent(
              activeRestaurantId,
              user?.uid || 'owner',
              userProfile?.name || 'Owner',
              'SUBSCRIPTION_ACTIVATED',
              'Subscription',
              'current',
              `Verified Razorpay payment (${verifyData.paymentId}) for STOQO PROFESSIONAL ₹799/month (79900 paise, INR). Valid until ${new Date(
                periodEndIsoVerified
              ).toLocaleDateString('en-IN')}.`
            );

            setVerifiedPaymentData({
              paymentId: verifyData.paymentId,
              orderId: verifyData.orderId,
              subscriptionId: verifyData.subscriptionId,
              amount: STOQO_PRO_PRICE_INR,
              amountInPaise: STOQO_PRO_AMOUNT_PAISE,
              currency: STOQO_PRO_CURRENCY,
              currentPeriodEnd: periodEndIsoVerified,
              verifiedAt: verifyData.verifiedAt || nowIso,
            });
            setPaymentSuccess(true);
          } catch (e: any) {
            setErrorMessage('Payment verification error: ' + (e?.message || 'Verification failed'));
          } finally {
            setProcessing(false);
          }
        },
      };

      const rzp = new Razorpay(rzpOptions);
      rzp.on('payment.failed', async (failedResp: any) => {
        const reason = failedResp?.error?.description || 'Payment failed at gateway';
        await persistSubscriptionStatusChange('PAYMENT_FAILED', {
          lastError: reason,
        });
        setErrorMessage(`Payment failed: ${reason}`);
        setProcessing(false);
      });

      rzp.open();
    } catch (e: any) {
      setErrorMessage(
        e?.message ||
          'Payment gateway configuration required (Razorpay keys not set in server environment).'
      );
      setProcessing(false);
    }
  };

  const handleCancelAtPeriodEnd = async () => {
    if (!activeRestaurantId) return;
    try {
      await persistSubscriptionStatusChange('CANCELLED', {
        cancelAtPeriodEnd: true,
      });
      const restRef = doc(db, 'restaurants', activeRestaurantId);
      await updateDoc(restRef, {
        'subscription.status': 'CANCELLED',
      });
    } catch (err) {
      console.error('Failed to cancel subscription:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Subscription Management Header Card */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              STOQO Subscription & Billing Management
            </h1>
            <Badge variant={statusBadgeVariant(lifecycleStatus)} size="sm">
              {lifecycleStatus}
            </Badge>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Plan: <strong className="text-stone-800 font-semibold">STOQO PROFESSIONAL (₹799 / month)</strong> •{' '}
            {lifecycleStatus === 'ACTIVE' ? 'Next Renewal Date:' : 'Valid Through:'}{' '}
            <strong className="text-stone-800 font-semibold">{formattedRenewalDate}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {lifecycleStatus === 'ACTIVE' && !subscriptionDoc?.cancelAtPeriodEnd && (
            <button
              id="cancel-sub-btn"
              type="button"
              onClick={handleCancelAtPeriodEnd}
              className="px-3.5 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-lg text-xs font-semibold transition-colors"
            >
              Cancel at Period End
            </button>
          )}
          <button
            id="upgrade-sub-btn"
            type="button"
            onClick={handleOpenCheckout}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {lifecycleStatus === 'ACTIVE'
                ? 'Renew / Manage STOQO Professional (₹799/mo)'
                : 'Activate STOQO Professional — ₹799 / month'}
            </span>
          </button>
        </div>
      </div>

      {/* Existing Customer Protection Notice */}
      {isLegacyCustomerPricing && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-950">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Existing Customer Rate Protection Active</p>
            <p className="text-amber-800">
              Your existing subscription record (₹{existingAmount}) remains untouched through your current cycle ending on{' '}
              <strong>{formattedRenewalDate}</strong>. You will never be unexpectedly charged. The updated{' '}
              <strong>STOQO PROFESSIONAL ₹799 / month</strong> rate applies only when you explicitly renew or upgrade with your consent.
            </p>
          </div>
        </div>
      )}

      {/* Main Pricing Card — STOQO PROFESSIONAL ₹799 / month */}
      <div className="max-w-3xl mx-auto pt-2">
        <div className="bg-stone-950 text-white rounded-2xl border border-stone-800 p-6 sm:p-8 shadow-xl relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 bg-[#FF5A1F] text-white font-black text-[10px] uppercase tracking-wider px-3.5 py-1.5 rounded-bl-xl">
            Professional Monthly
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-stone-800">
            <div className="space-y-1.5">
              <StoqoLogo variant="compact" theme="dark" size="md" showTagline={true} />
              <h2 className="text-lg sm:text-xl font-black tracking-wide text-white uppercase pt-2">
                STOQO PROFESSIONAL
              </h2>
              <p className="text-xs font-semibold text-[#FF7A29]">
                Smart Stock. Smarter Business.
              </p>
            </div>

            <div className="sm:text-right bg-stone-900/90 border border-stone-800 px-5 py-4 rounded-xl">
              <div className="flex items-baseline sm:justify-end gap-1">
                <span className="text-3xl sm:text-4xl font-black text-white">₹799</span>
                <span className="text-xs text-stone-300 font-semibold">/ month</span>
              </div>
              <p className="text-[11px] text-stone-400 mt-1">
                Currency: INR • 79,900 paise • Renews every month
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs text-stone-200">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Unlimited Inventory SKUs & Store Items</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Weighted Average Costing (WAC) Engine</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Purchase Price Hike Guard & Alerts</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Official WhatsApp Business PO Dispatch</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Multi-Role Staff Access (Owner, Manager, Storekeeper)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>AI Store Assistant & 15-Day Purchase Planner</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Vendor Ledger, Payments & Invoice Reconciliation</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#FF5A1F] shrink-0" />
              <span>Petpooja / eZee POS Integration & Audit Trail</span>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>14-day free trial included for new stores • Secure Razorpay verification</span>
            </div>

            <button
              id="activate-stoqo-pro-btn"
              type="button"
              onClick={handleOpenCheckout}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#FF5A1F] hover:bg-[#e04812] text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-md cursor-pointer"
            >
              {lifecycleStatus === 'ACTIVE'
                ? 'Renew STOQO Professional (₹799 / month)'
                : 'Subscribe Now — ₹799 / month'}
            </button>
          </div>
        </div>
      </div>

      {/* Subscription Lifecycle & Payment Details Table */}
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-stone-700" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900">
              Subscription Lifecycle & Billing Summary
            </h3>
          </div>
          <span className="text-[11px] text-stone-500">
            Tenant ID: <code className="font-mono text-stone-700">{activeRestaurant?.id}</code>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200/80">
            <span className="text-[10px] font-semibold uppercase text-stone-400 block">
              Plan & Billing Cycle
            </span>
            <p className="font-bold text-stone-900 mt-1">STOQO PROFESSIONAL</p>
            <p className="text-stone-600 mt-0.5">₹799 / month (INR • 79,900 paise)</p>
          </div>

          <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200/80">
            <span className="text-[10px] font-semibold uppercase text-stone-400 block">
              Current Lifecycle Status
            </span>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={statusBadgeVariant(lifecycleStatus)} size="sm">
                {lifecycleStatus}
              </Badge>
            </div>
            <p className="text-stone-500 text-[11px] mt-1">
              Supported: ACTIVE, PENDING, PAYMENT_FAILED, CANCELLED, EXPIRED
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200/80">
            <span className="text-[10px] font-semibold uppercase text-stone-400 block">
              Renewal / Expiry Date
            </span>
            <p className="font-bold text-stone-900 mt-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
              {formattedRenewalDate}
            </p>
            <p className="text-stone-500 text-[11px] mt-0.5">
              {subscriptionDoc?.lastVerifiedPaymentAt
                ? `Last verified: ${new Date(subscriptionDoc.lastVerifiedPaymentAt).toLocaleDateString('en-IN')}`
                : 'Updated automatically upon verified payment'}
            </p>
          </div>
        </div>
      </div>

      {/* Checkout & Payment Confirmation Modal */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title={paymentSuccess ? 'Payment Confirmed — STOQO PROFESSIONAL' : 'STOQO PROFESSIONAL Checkout'}
        subtitle="Smart Stock. Smarter Business. • ₹799 / month"
        maxWidth="md"
      >
        {paymentSuccess && verifiedPaymentData ? (
          /* Payment Confirmation Screen */
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-1.5">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <h4 className="text-sm font-black text-emerald-950 uppercase tracking-wide">
                STOQO PROFESSIONAL Activated
              </h4>
              <p className="text-xs text-emerald-800 font-semibold">
                ₹799 / month • Smart Stock. Smarter Business.
              </p>
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-stone-500">Product & Plan:</span>
                <span className="font-bold text-stone-900">STOQO PROFESSIONAL (Monthly)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Verified Amount Paid:</span>
                <span className="font-bold text-emerald-700">
                  ₹{verifiedPaymentData.amount} / month ({verifiedPaymentData.amountInPaise} paise {verifiedPaymentData.currency})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Razorpay Payment ID:</span>
                <span className="font-mono text-stone-800">{verifiedPaymentData.paymentId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Subscription Status:</span>
                <Badge variant="success" size="sm">ACTIVE</Badge>
              </div>
              <div className="flex justify-between pt-2 border-t border-stone-200">
                <span className="text-stone-600 font-semibold">Next Monthly Renewal:</span>
                <span className="font-bold text-stone-900">
                  {new Date(verifiedPaymentData.currentPeriodEnd).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>

            <button
              id="close-payment-confirmation-btn"
              type="button"
              onClick={() => {
                setIsCheckoutOpen(false);
                setPaymentSuccess(false);
              }}
              className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-bold transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          /* Checkout Screen */
          <div className="space-y-4">
            <div className="p-4 bg-stone-950 text-white rounded-xl border border-stone-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black tracking-wider uppercase text-[#FF7A29]">
                  STOQO PROFESSIONAL
                </span>
                <span className="text-[11px] bg-stone-800 text-stone-200 px-2 py-0.5 rounded font-semibold">
                  Monthly Billing
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-white">₹799</span>
                <span className="text-xs text-stone-300 font-medium">/ month</span>
              </div>
              <p className="text-[11px] text-stone-400">
                Smart Stock. Smarter Business.
              </p>
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-stone-600">Restaurant Tenant:</span>
                <span className="font-bold text-stone-900">{activeRestaurant?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-600">Plan:</span>
                <span className="font-bold text-stone-900">Professional Monthly</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-600">Billing Cycle & Renewal:</span>
                <span className="font-semibold text-stone-800">Monthly (Every month)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-600">Currency & Paise:</span>
                <span className="font-mono text-stone-700">INR (79900 paise)</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-stone-200">
                <span className="text-stone-900 font-bold">Total Payable Today:</span>
                <span className="text-sm font-black text-stone-900">₹799 / month</span>
              </div>
            </div>

            {isLegacyCustomerPricing && (
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  I acknowledge and consent to renewing my subscription under the updated{' '}
                  <strong>STOQO PROFESSIONAL ₹799 / month</strong> pricing policy.
                </span>
              </label>
            )}

            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Payment Gateway Notice: </span>
                  {errorMessage}
                </div>
              </div>
            )}

            <button
              id="confirm-upgrade-pay-btn"
              type="button"
              onClick={handleInitiateUpgrade}
              disabled={processing}
              className="w-full py-2.5 bg-[#FF5A1F] hover:bg-[#e04812] text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {processing
                ? 'Verifying with Razorpay Server...'
                : 'Proceed to Secure Razorpay Payment (₹799 / month)'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
};
