import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  CheckCircle,
  XCircle,
  RefreshCw,
  Send,
  Unlink,
  Link,
  ShieldAlert,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Check,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { WhatsAppSettings } from '../../types';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import {
  fetchWhatsAppStatus,
  connectWhatsAppApi,
  disconnectWhatsAppApi,
  sendTestWhatsAppMessageApi,
  WhatsAppStatusResponse,
} from '../../services/whatsappClient';

export const WhatsAppSettingsCard: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, activeRole, hasRole } = useAuth();
  const isOwner = activeRole === 'OWNER' || (activeRestaurant && activeRestaurant.ownerUid === user?.uid);

  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [healthInfo, setHealthInfo] = useState<WhatsAppStatusResponse | null>(null);

  // Connect Modal state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [businessPhone, setBusinessPhone] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [customAccessToken, setCustomAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Test Message Modal state
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Disconnect confirmation
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Listen to Firestore settings/whatsapp
  useEffect(() => {
    if (!activeRestaurantId) return;

    const docRef = doc(db, 'restaurants', activeRestaurantId, 'settings', 'whatsapp');
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as WhatsAppSettings;
        setSettings(data);
        if (data.businessPhoneNumber && !businessPhone) {
          setBusinessPhone(data.businessPhoneNumber);
        }
        if (data.phoneNumberId && !phoneNumberId) {
          setPhoneNumberId(data.phoneNumberId);
        }
        if (data.businessAccountId && !businessAccountId) {
          setBusinessAccountId(data.businessAccountId);
        }
      } else {
        setSettings(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [activeRestaurantId]);

  // Check health on mount or manual refresh
  const triggerHealthCheck = async () => {
    if (!activeRestaurantId) return;
    try {
      setIsCheckingHealth(true);
      const res = await fetchWhatsAppStatus(activeRestaurantId);
      setHealthInfo(res);
    } catch (e) {
      console.error('Health check failed:', e);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    if (activeRestaurantId) {
      triggerHealthCheck();
    }
  }, [activeRestaurantId]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !user) return;

    if (!isOwner) {
      setConnectError('Only the restaurant Owner can connect WhatsApp Business.');
      return;
    }

    try {
      setConnecting(true);
      setConnectError('');

      await connectWhatsAppApi({
        restaurantId: activeRestaurantId,
        businessPhoneNumber: businessPhone.trim(),
        phoneNumberId: phoneNumberId.trim(),
        businessAccountId: businessAccountId.trim(),
        accessToken: customAccessToken.trim() || undefined,
        userUid: user.uid,
        userName: userProfile?.name || 'Owner',
        userRole: activeRole || 'OWNER',
      });

      setIsConnectModalOpen(false);
      setCustomAccessToken('');
      await triggerHealthCheck();
    } catch (err: any) {
      setConnectError(err.message || 'Failed to connect WhatsApp Business');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!activeRestaurantId || !user) return;

    if (!isOwner) {
      alert('Only the restaurant Owner is authorized to disconnect WhatsApp Business.');
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to disconnect WhatsApp Business? Staff will no longer be able to send Purchase Orders via WhatsApp until reconnected.'
    );
    if (!confirmed) return;

    try {
      setIsDisconnecting(true);
      await disconnectWhatsAppApi({
        restaurantId: activeRestaurantId,
        userUid: user.uid,
        userName: userProfile?.name || 'Owner',
        userRole: activeRole || 'OWNER',
      });
      await triggerHealthCheck();
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect WhatsApp');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !user || !testPhone.trim()) return;

    try {
      setSendingTest(true);
      setTestResult(null);

      const res = await sendTestWhatsAppMessageApi({
        restaurantId: activeRestaurantId,
        recipientPhone: testPhone.trim(),
        userUid: user.uid,
        userName: userProfile?.name || 'Owner',
        userRole: activeRole || 'OWNER',
      });

      setTestResult({
        success: true,
        message: `Live test message transmitted successfully! (Message ID: ${res.messageId})`,
      });
      await triggerHealthCheck();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to dispatch test message',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const isConnected = settings?.connected === true && healthInfo?.status === 'CONNECTED';
  const displayPhone = settings?.businessPhoneNumber || healthInfo?.businessPhoneNumber || 'Not Configured';
  const connectedBy = settings?.connectedByName || 'Owner';
  const connectedDate = settings?.connectedAt
    ? new Date(settings.connectedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Recently';

  const lastHealthTime = healthInfo?.lastHealthCheckAt
    ? new Date(healthInfo.lastHealthCheckAt).toLocaleTimeString('en-IN')
    : 'Just now';

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
              WhatsApp Business Platform
            </h2>
            <p className="text-[11px] text-stone-500">
              Official Meta Cloud API • Server-to-Server Dispatches • Staff Mobile Integration
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={triggerHealthCheck}
          disabled={isCheckingHealth}
          title="Refresh connection health"
          className="flex items-center gap-1 text-[11px] font-semibold text-stone-600 hover:text-stone-900 px-2.5 py-1 rounded-md border border-stone-200 bg-stone-50"
        >
          <RefreshCw className={`w-3 h-3 ${isCheckingHealth ? 'animate-spin text-emerald-600' : ''}`} />
          Health Check
        </button>
      </div>

      {/* Connected State Screen */}
      {isConnected ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between bg-emerald-50/60 border border-emerald-200 rounded-xl p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
                  WhatsApp Connected
                </span>
                <Badge variant="success" size="sm">
                  Official Cloud API
                </Badge>
              </div>
              <p className="text-xs text-emerald-800">
                Staff can send Purchase Orders directly from the system. No browser or WhatsApp Web required.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Business Number</p>
              <p className="text-sm font-semibold text-stone-900 font-mono mt-0.5">{displayPhone}</p>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Connected By</p>
              <p className="text-sm font-semibold text-stone-900 mt-0.5">{connectedBy}</p>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Connected On</p>
              <p className="text-sm font-semibold text-stone-900 mt-0.5">{connectedDate}</p>
            </div>

            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Last Health Check</p>
              <p className="text-sm font-semibold text-emerald-700 mt-0.5 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Healthy ({lastHealthTime})
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100">
            {isOwner ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setTestPhone(settings?.businessPhoneNumber || '');
                    setTestResult(null);
                    setIsTestModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                >
                  <Send className="w-3.5 h-3.5" /> Send Test Message
                </button>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect WhatsApp'}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-stone-500 italic">
                <ShieldAlert className="w-4 h-4 text-stone-400" />
                Only the restaurant Owner can disconnect or test WhatsApp Business settings.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Disconnected State Screen */
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-rose-50/60 border border-rose-200 rounded-xl p-4">
            <div className="p-2 rounded-full bg-rose-100 text-rose-700 mt-0.5">
              <XCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rose-900 uppercase tracking-wide">
                  🔴 WhatsApp Not Connected
                </span>
              </div>
              <p className="text-xs text-stone-700 font-medium">
                Please ask the Owner to connect WhatsApp Business before sending purchase orders.
              </p>
              <p className="text-[11px] text-stone-500">
                Staff will be unable to dispatch POs directly until the restaurant's official Meta WhatsApp Business number is verified.
              </p>
            </div>
          </div>

          {healthInfo?.error && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Recent Connection Notice:</p>
                <p className="text-[11px] mt-0.5">{healthInfo.error}</p>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between border-t border-stone-100">
            {isOwner ? (
              <button
                type="button"
                onClick={() => {
                  setConnectError('');
                  setIsConnectModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
              >
                <Link className="w-3.5 h-3.5" /> Connect WhatsApp Business
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <ShieldAlert className="w-4 h-4 text-stone-400" />
                Staff role detected ({activeRole}). Only the Owner is authorized to link the restaurant WhatsApp account.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Owner Connect WhatsApp Modal */}
      <Modal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        title="Connect Official WhatsApp Business"
        subtitle="One-time owner connection using WhatsApp Business Platform / Cloud API"
        maxWidth="lg"
      >
        <form onSubmit={handleConnect} className="space-y-4 text-xs">
          {connectError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Verification Error:</p>
                <p className="text-[11px] mt-0.5">{connectError}</p>
              </div>
            </div>
          )}

          <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1.5 text-stone-600">
            <p className="font-bold text-stone-800 uppercase tracking-wider text-[10px]">
              One-Time Owner Setup Instructions:
            </p>
            <p className="text-[11px]">
              1. Register or select your restaurant's WhatsApp Business app at{' '}
              <a
                href="https://developers.facebook.com"
                target="_blank"
                rel="noreferrer"
                className="text-amber-700 hover:underline inline-flex items-center gap-0.5 font-semibold"
              >
                Meta for Developers <ExternalLink className="w-2.5 h-2.5" />
              </a>
              .
            </p>
            <p className="text-[11px]">
              2. Enter your <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID</strong> below.
            </p>
            <p className="text-[11px]">
              3. Once verified, storekeeper and kitchen staff can send purchase orders without opening browser tabs or scanning QR codes.
            </p>
          </div>

          <div>
            <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
              Official WhatsApp Business Phone Number *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. +91 98765 43210"
              value={businessPhone}
              onChange={(e) => setBusinessPhone(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-stone-500 mt-1">
              The phone number registered on Meta Cloud API for {activeRestaurant?.name || 'this restaurant'}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                Phone Number ID *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 109283746592817"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-stone-400 mt-1">Found in Meta App → WhatsApp → API Setup</p>
            </div>

            <div>
              <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                Business Account ID (WABA ID) *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 982736451928374"
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-stone-400 mt-1">Found in Meta App → WhatsApp → API Setup</p>
            </div>
          </div>

          <div>
            <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
              Custom Permanent Access Token (Optional)
            </label>
            <input
              type="password"
              placeholder="Leave blank to use server environment token (WHATSAPP_ACCESS_TOKEN)"
              value={customAccessToken}
              onChange={(e) => setCustomAccessToken(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
            />
            <p className="text-[10px] text-stone-400 mt-1">
              Stored securely in backend memory vault. Never saved to public Firestore documents.
            </p>
          </div>

          <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg space-y-1 text-[11px] text-stone-600">
            <p className="font-semibold text-stone-800">Webhook Configuration Endpoint:</p>
            <p className="font-mono text-stone-700 select-all bg-white p-1 rounded border border-stone-200">
              {window.location.origin}/api/whatsapp/webhook
            </p>
            <p className="text-[10px] text-stone-500">
              Subscribe to "messages" field in Meta Webhook to receive delivery & read receipts.
            </p>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(false)}
              className="px-4 py-2 text-stone-600 font-semibold text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying with Meta...
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" /> Connect & Verify Account
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Send Test Message Modal */}
      <Modal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        title="Send WhatsApp Test Message"
        subtitle="Verify real-time dispatch via Meta WhatsApp Business Cloud API"
        maxWidth="md"
      >
        <form onSubmit={handleSendTestMessage} className="space-y-4 text-xs">
          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">{testResult.success ? 'Success:' : 'Transmission Failed:'}</p>
                <p className="text-[11px] mt-0.5">{testResult.message}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
              Recipient WhatsApp Mobile Number *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. 9876543210 or +91 9876543210"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-stone-500 mt-1">
              Indian 10-digit mobile numbers are automatically normalized to +91 country format.
            </p>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsTestModalOpen(false)}
              className="px-4 py-2 text-stone-600 font-semibold text-xs"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={sendingTest}
              className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs rounded-lg shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {sendingTest ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Transmitting...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Dispatch Test Message
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
