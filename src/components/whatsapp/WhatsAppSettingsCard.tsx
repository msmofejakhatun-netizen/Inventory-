import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  CheckCircle,
  XCircle,
  RefreshCw,
  Send,
  Unlink,
  ShieldAlert,
  AlertTriangle,
  Check,
  Smartphone,
  ShieldCheck,
  Radio,
  Activity,
  RotateCw,
  Settings2,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { WhatsAppSettings } from '../../types';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import {
  fetchWhatsAppStatus,
  fetchEmbeddedSignupConfig,
  completeEmbeddedSignupApi,
  disconnectWhatsAppApi,
  sendTestWhatsAppMessageApi,
  WhatsAppStatusResponse,
  EmbeddedSignupConfigResponse,
} from '../../services/whatsappClient';
import { launchMetaEmbeddedSignup } from '../../services/metaEmbeddedSignup';

export const WhatsAppSettingsCard: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, activeRole } = useAuth();
  const isOwner =
    activeRole === 'OWNER' ||
    (activeRestaurant && activeRestaurant.ownerUid === user?.uid);

  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [healthInfo, setHealthInfo] = useState<WhatsAppStatusResponse | null>(null);
  const [signupConfig, setSignupConfig] = useState<EmbeddedSignupConfigResponse | null>(null);

  // Embedded Signup Flow state
  const [coexistenceMode, setCoexistenceMode] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStage, setConnectStage] = useState<string>('');
  const [connectError, setConnectError] = useState<string>('');
  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);

  // Test Connection / Live Test Message Modal state
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Disconnect confirmation Modal state (replaces browser confirm/alert)
  const [isDisconnectModalOpen, setIsDisconnectModalOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Listen to Firestore settings/whatsapp (non-secret status metadata only)
  useEffect(() => {
    if (!activeRestaurantId) return;

    const docRef = doc(db, 'restaurants', activeRestaurantId, 'settings', 'whatsapp');
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as WhatsAppSettings);
      } else {
        setSettings(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [activeRestaurantId]);

  const loadConfigAndStatus = async () => {
    if (!activeRestaurantId) return;
    try {
      setIsCheckingHealth(true);
      const [statusRes, cfgRes] = await Promise.all([
        fetchWhatsAppStatus(activeRestaurantId),
        fetchEmbeddedSignupConfig(activeRestaurantId),
      ]);
      setHealthInfo(statusRes);
      setSignupConfig(cfgRes);
    } catch (e) {
      console.error('WhatsApp status/config check error:', e);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    if (activeRestaurantId) {
      loadConfigAndStatus();
    }
  }, [activeRestaurantId]);

  const handleLaunchEmbeddedSignup = async () => {
    if (!activeRestaurantId || !user) return;

    if (!isOwner) {
      setConnectError('Only the restaurant Owner is authorized to connect WhatsApp Business.');
      return;
    }

    setConnectError('');
    setStatusNotice(null);

    try {
      setConnecting(true);
      setConnectStage('Checking Meta Embedded Signup configuration...');

      const latestConfig = await fetchEmbeddedSignupConfig(activeRestaurantId);
      setSignupConfig(latestConfig);

      if (!latestConfig.ready || !latestConfig.appId || !latestConfig.configId) {
        const missingList =
          latestConfig.missingRequirements.length > 0
            ? latestConfig.missingRequirements.map((m) => m.label).join(', ')
            : 'META_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID, WHATSAPP_APP_SECRET';
        setConnectError(
          `Meta Embedded Signup requires server & Meta App setup before launching: ${missingList}. Configure these credentials in your Meta for Developers app and environment variables.`
        );
        return;
      }

      setConnectStage('Opening official Meta WhatsApp Business signup...');
      const signupResult = await launchMetaEmbeddedSignup({
        appId: latestConfig.appId,
        configId: latestConfig.configId,
        graphApiVersion: latestConfig.graphApiVersion || 'v25.0',
        coexistenceMode,
      });

      setConnectStage('Verifying WABA, phone number, Cloud API permissions, and webhooks...');
      const completion = await completeEmbeddedSignupApi({
        restaurantId: activeRestaurantId,
        code: signupResult.code,
        wabaId: signupResult.wabaId,
        phoneNumberId: signupResult.phoneNumberId,
        businessId: signupResult.businessId,
        eventType: signupResult.eventType,
        coexistenceRequested: coexistenceMode,
        userUid: user.uid,
        userName: userProfile?.name || 'Owner',
        userRole: activeRole || 'OWNER',
      });

      await loadConfigAndStatus();

      if (completion.connected && completion.status === 'CONNECTED') {
        setStatusNotice({
          type: 'success',
          message:
            completion.message ||
            'WhatsApp Business connected and verified via official Meta Embedded Signup.',
        });
      } else {
        setConnectError(
          completion.error ||
            'Meta authorization completed, but additional verification is required before status becomes Connected.'
        );
      }
    } catch (err: any) {
      setConnectError(err.message || 'Meta WhatsApp Embedded Signup could not be completed.');
    } finally {
      setConnecting(false);
      setConnectStage('');
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!activeRestaurantId || !user) return;
    if (!isOwner) {
      setConnectError('Only the restaurant Owner is authorized to disconnect WhatsApp Business.');
      setIsDisconnectModalOpen(false);
      return;
    }

    try {
      setIsDisconnecting(true);
      setConnectError('');
      await disconnectWhatsAppApi({
        restaurantId: activeRestaurantId,
        userUid: user.uid,
        userName: userProfile?.name || 'Owner',
        userRole: activeRole || 'OWNER',
      });
      setIsDisconnectModalOpen(false);
      setStatusNotice({
        type: 'info',
        message: 'WhatsApp Business has been disconnected for this restaurant.',
      });
      await loadConfigAndStatus();
    } catch (err: any) {
      setConnectError(err.message || 'Failed to disconnect WhatsApp Business.');
      setIsDisconnectModalOpen(false);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleTestConnectionClick = async () => {
    await loadConfigAndStatus();
    setTestPhone(
      healthInfo?.businessPhoneNumber || settings?.businessPhoneNumber || ''
    );
    setTestResult(null);
    setIsTestModalOpen(true);
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
      await loadConfigAndStatus();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to dispatch test message',
      });
    } finally {
      setSendingTest(false);
    }
  };

  // Resolve real connection status from verified backend + Firestore state
  const resolvedStatus = healthInfo?.status || settings?.status || 'NOT_CONNECTED';
  const normalizedStatus =
    resolvedStatus === 'DISCONNECTED' ? 'NOT_CONNECTED' : resolvedStatus;

  const isConnected =
    normalizedStatus === 'CONNECTED' &&
    Boolean(healthInfo ? healthInfo.connected : settings?.connected);

  const isActionRequired =
    normalizedStatus === 'ACTION_REQUIRED' ||
    normalizedStatus === 'CONFIGURATION_ERROR' ||
    (!isConnected && Boolean(signupConfig && !signupConfig.ready));

  const isConnectionError =
    normalizedStatus === 'CONNECTION_ERROR' ||
    normalizedStatus === 'AUTH_ERROR' ||
    normalizedStatus === 'SERVER_ERROR';

  const displayPhone =
    healthInfo?.businessPhoneNumber || settings?.businessPhoneNumber || 'Not Linked';
  const verifiedName = healthInfo?.verifiedName || settings?.verifiedName || '';
  const apiHealth =
    healthInfo?.apiStatus ||
    healthInfo?.healthStatus ||
    settings?.apiStatus ||
    settings?.healthStatus ||
    'DISCONNECTED';
  const webhookStatus =
    healthInfo?.webhookStatus || settings?.webhookStatus || 'INACTIVE';
  const checks = healthInfo?.verificationChecks || settings?.verificationChecks;
  const isCoexistenceActive = Boolean(
    healthInfo?.coexistenceMode ?? settings?.coexistenceMode
  );

  const diagnosticError = connectError || healthInfo?.error || settings?.lastError || '';

  const renderStatusBadge = () => {
    if (isConnected) {
      return (
        <Badge variant="success" size="sm">
          CONNECTED
        </Badge>
      );
    }
    if (isConnectionError) {
      return (
        <Badge variant="danger" size="sm">
          CONNECTION ERROR
        </Badge>
      );
    }
    if (isActionRequired) {
      return (
        <Badge variant="warning" size="sm">
          ACTION REQUIRED
        </Badge>
      );
    }
    return (
      <Badge variant="neutral" size="sm">
        NOT CONNECTED
      </Badge>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 sm:p-6 shadow-2xs space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                WhatsApp Business
              </h2>
              {renderStatusBadge()}
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Official Meta Embedded Signup • WhatsApp Business Cloud API
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadConfigAndStatus}
          disabled={isCheckingHealth}
          title="Refresh connection status"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-600 hover:text-stone-900 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 min-h-[36px]"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isCheckingHealth ? 'animate-spin text-emerald-600' : ''}`}
          />
          Refresh Status
        </button>
      </div>

      {/* Transient Notification Banner */}
      {statusNotice && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
            statusNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : statusNotice.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-stone-50 border-stone-200 text-stone-800'
          }`}
        >
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <p className="font-medium">{statusNotice.message}</p>
        </div>
      )}

      {loading && !healthInfo ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-stone-500">
          <RefreshCw className="w-4 h-4 animate-spin text-stone-400" />
          Checking WhatsApp Business connection...
        </div>
      ) : isConnected ? (
        /* ================================================================
         * CONNECTED SCREEN
         * ================================================================ */
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 bg-emerald-50/70 border border-emerald-200 rounded-xl p-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <h3 className="text-sm font-bold text-emerald-950">
                  WhatsApp Business Connected
                </h3>
                {isCoexistenceActive && (
                  <Badge variant="info" size="sm">
                    App Coexistence Active
                  </Badge>
                )}
              </div>
              <p className="text-xs text-emerald-800">
                {verifiedName ? `${verifiedName} • ` : ''}
                Purchase Orders are dispatched directly from STOQO via Meta Cloud API.
              </p>
            </div>
          </div>

          {/* Verified Status Readout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1">
                <Smartphone className="w-3 h-3 text-stone-400" /> Business Number
              </p>
              <p className="text-sm font-bold text-stone-900 font-mono mt-1 break-all">
                {displayPhone}
              </p>
            </div>

            <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Connection
              </p>
              <p className="text-sm font-bold text-emerald-700 mt-1 flex items-center gap-1">
                <Check className="w-4 h-4" /> Active
              </p>
            </div>

            <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-600" /> API Status
              </p>
              <p
                className={`text-sm font-bold mt-1 flex items-center gap-1 ${
                  apiHealth === 'HEALTHY'
                    ? 'text-emerald-700'
                    : apiHealth === 'DEGRADED'
                      ? 'text-amber-700'
                      : 'text-rose-700'
                }`}
              >
                {apiHealth === 'HEALTHY'
                  ? 'Healthy'
                  : apiHealth === 'DEGRADED'
                    ? 'Degraded'
                    : 'Unhealthy'}
              </p>
            </div>

            <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1">
                <Radio className="w-3 h-3 text-emerald-600" /> Webhook Status
              </p>
              <p
                className={`text-sm font-bold mt-1 ${
                  webhookStatus === 'ACTIVE' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {webhookStatus === 'ACTIVE' ? 'Active' : 'Action Required'}
              </p>
            </div>
          </div>

          {/* Server-Side Verification Checklist */}
          {checks && (
            <div className="flex flex-wrap gap-2 text-[11px] pt-1">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium ${
                  checks.wabaVerified
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <Check className="w-3 h-3" /> WABA Verified
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium ${
                  checks.phoneVerified
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <Check className="w-3 h-3" /> Phone Verified
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium ${
                  checks.permissionsVerified
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <Check className="w-3 h-3" /> Cloud API Permissions
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium ${
                  checks.webhookSubscribed && checks.webhookEndpointVerified
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <Check className="w-3 h-3" /> Webhook Active
              </span>
            </div>
          )}

          {diagnosticError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p>{diagnosticError}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-stone-100">
            {isOwner ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleTestConnectionClick}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" /> Test Connection
                  </button>

                  <button
                    type="button"
                    onClick={handleLaunchEmbeddedSignup}
                    disabled={connecting}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                    {connecting ? 'Reconnecting...' : 'Reconnect'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsDisconnectModalOpen(true)}
                  disabled={isDisconnecting}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 w-full sm:w-auto"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect WhatsApp
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-stone-500 italic">
                <ShieldAlert className="w-4 h-4 text-stone-400 shrink-0" />
                Only the restaurant Owner can test, reconnect, or disconnect WhatsApp Business.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================================================================
         * NOT CONNECTED / ACTION REQUIRED / CONNECTION ERROR SCREEN
         * ================================================================ */
        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 sm:p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${
                  isConnectionError
                    ? 'bg-rose-100 text-rose-700'
                    : isActionRequired
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {isConnectionError ? (
                  <XCircle className="w-5 h-5" />
                ) : isActionRequired ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <MessageSquare className="w-5 h-5" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">
                  Connect Your WhatsApp Business
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Connect your restaurant&apos;s WhatsApp Business account to STOQO.
                </p>
              </div>
            </div>

            {/* Official 3-Step Meta Embedded Signup Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="bg-white border border-stone-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                  Step 1
                </span>
                <p className="font-semibold text-stone-900">Meta Business Login</p>
                <p className="text-[11px] text-stone-500">
                  Sign in with your Facebook / Meta Business account inside Meta&apos;s official popup.
                </p>
              </div>
              <div className="bg-white border border-stone-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                  Step 2
                </span>
                <p className="font-semibold text-stone-900">Business &amp; WABA</p>
                <p className="text-[11px] text-stone-500">
                  Select your Business Portfolio and create or select your WhatsApp Business Account.
                </p>
              </div>
              <div className="bg-white border border-stone-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                  Step 3
                </span>
                <p className="font-semibold text-stone-900">Verify Phone Number</p>
                <p className="text-[11px] text-stone-500">
                  Enter and verify your restaurant&apos;s WhatsApp number directly with Meta—no IDs or tokens needed.
                </p>
              </div>
            </div>

            {/* Coexistence Option */}
            {isOwner && (
              <label className="flex items-start gap-3 p-3.5 bg-white border border-stone-200 rounded-xl cursor-pointer hover:border-stone-300 transition-colors">
                <input
                  type="checkbox"
                  checked={coexistenceMode}
                  onChange={(e) => setCoexistenceMode(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="text-xs space-y-0.5">
                  <span className="font-semibold text-stone-900 block">
                    Connect my existing WhatsApp Business mobile app number (Coexistence)
                  </span>
                  <span className="text-[11px] text-stone-500 block leading-relaxed">
                    Keep using the WhatsApp Business app on your phone alongside STOQO Cloud API where eligible in Meta&apos;s Embedded Signup flow.
                  </span>
                </div>
              </label>
            )}
          </div>

          {/* Diagnostic Error or Action Required Message */}
          {diagnosticError && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                isConnectionError
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  isConnectionError ? 'text-rose-600' : 'text-amber-600'
                }`}
              />
              <div className="space-y-1">
                <p className="font-bold">
                  {isConnectionError ? 'Connection Error' : 'Action Required'}
                </p>
                <p className="text-[11px] leading-relaxed">{diagnosticError}</p>
              </div>
            </div>
          )}

          {/* Meta Configuration Readiness Report (if any prerequisite is missing) */}
          {signupConfig && !signupConfig.ready && (
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center gap-2 text-amber-950 font-bold">
                <Settings2 className="w-4 h-4 text-amber-600 shrink-0" />
                Meta Embedded Signup Configuration Missing
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                STOQO uses Meta&apos;s official Embedded Signup OAuth flow rather than manual tokens. Complete the following Meta App configuration before launching one-click onboarding:
              </p>
              <ul className="space-y-1.5 text-[11px] text-amber-950">
                {signupConfig.missingRequirements.map((req) => (
                  <li
                    key={req.key}
                    className="p-2.5 bg-white/80 rounded-lg border border-amber-200/80 space-y-0.5"
                  >
                    <p className="font-semibold font-mono text-[11px]">{req.label}</p>
                    <p className="text-amber-800">{req.description}</p>
                    {req.dashboardSource && (
                      <p className="text-[10px] text-stone-600 pt-0.5">
                        <span className="font-semibold text-stone-800">Meta Dashboard Source:</span>{' '}
                        {req.dashboardSource}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="pt-1 text-[11px] text-amber-900 space-y-1">
                <p className="font-semibold">Webhook Callback URL for Meta App Dashboard:</p>
                <p className="font-mono text-[11px] bg-white px-2.5 py-1.5 rounded border border-amber-200 select-all break-all">
                  {window.location.origin}/api/whatsapp/webhook
                </p>
              </div>
            </div>
          )}

          {/* Primary One-Click Connect CTA */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-stone-100">
            {isOwner ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleLaunchEmbeddedSignup}
                  disabled={connecting}
                  className="flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] bg-[#0D2149] hover:bg-[#143066] text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-colors disabled:opacity-60 w-full sm:w-auto"
                >
                  {connecting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-4 h-4 text-[#FF6B2C]" />
                      Connect WhatsApp Business
                    </>
                  )}
                </button>
                {connectStage && (
                  <span className="text-[11px] font-medium text-stone-600">
                    {connectStage}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <ShieldAlert className="w-4 h-4 text-stone-400 shrink-0" />
                Staff role detected ({activeRole}). Only the Owner is authorized to connect the restaurant&apos;s WhatsApp Business account.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test Connection / Live Test Message Modal */}
      <Modal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        title="Test WhatsApp Business Connection"
        subtitle="Verify live API health and dispatch a test message via Meta Cloud API"
        maxWidth="md"
      >
        <form onSubmit={handleSendTestMessage} className="space-y-4 text-xs">
          <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="text-stone-500 font-semibold">Connection</p>
              <p className="font-bold text-emerald-700 mt-0.5">
                {isConnected ? 'Active' : 'Action Needed'}
              </p>
            </div>
            <div>
              <p className="text-stone-500 font-semibold">API Status</p>
              <p className="font-bold text-stone-900 mt-0.5">{apiHealth}</p>
            </div>
            <div>
              <p className="text-stone-500 font-semibold">Webhook</p>
              <p className="font-bold text-stone-900 mt-0.5">{webhookStatus}</p>
            </div>
          </div>

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
                <p className="font-semibold">
                  {testResult.success ? 'Success:' : 'Transmission Failed:'}
                </p>
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
              className="w-full px-3 py-2.5 min-h-[44px] border border-stone-300 rounded-lg font-mono text-xs focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-stone-500 mt-1">
              Indian 10-digit mobile numbers are automatically normalized to +91 country format.
            </p>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsTestModalOpen(false)}
              className="px-4 py-2 min-h-[40px] text-stone-600 font-semibold text-xs"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={sendingTest}
              className="px-5 py-2 min-h-[40px] bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs rounded-lg shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {sendingTest ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Transmitting...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" /> Send Test Message
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Disconnect Confirmation Modal */}
      <Modal
        isOpen={isDisconnectModalOpen}
        onClose={() => setIsDisconnectModalOpen(false)}
        title="Disconnect WhatsApp Business"
        subtitle="Remove WhatsApp Business authorization from this restaurant"
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Staff will no longer be able to dispatch automatic WhatsApp Purchase Orders via Cloud API until an Owner reconnects WhatsApp Business.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsDisconnectModalOpen(false)}
              className="px-4 py-2 min-h-[40px] text-stone-700 font-semibold rounded-lg hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDisconnect}
              disabled={isDisconnecting}
              className="px-4 py-2 min-h-[40px] bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1.5"
            >
              <Unlink className="w-3.5 h-3.5" />
              {isDisconnecting ? 'Disconnecting...' : 'Confirm Disconnect'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
