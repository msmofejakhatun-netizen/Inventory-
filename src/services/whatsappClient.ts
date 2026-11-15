import { auth } from '../firebase/config';
import {
  WhatsAppMessageRecord,
  WhatsAppVerificationChecks,
  WhatsAppWebhookStatus,
} from '../types';

export interface MetaMissingRequirement {
  key: string;
  label: string;
  description: string;
  dashboardSource?: string;
}

export interface EmbeddedSignupConfigResponse {
  ready: boolean;
  webhookReady: boolean;
  embeddedSignupVersion?: 'v4';
  appId: string | null;
  configId: string | null;
  appIdSynced?: boolean;
  configIdSynced?: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  graphApiVersion: string;
  requiredPermissions?: string[];
  webhookCallbackUrl: string;
  coexistenceSupported: boolean;
  missingRequirements: MetaMissingRequirement[];
  metaPrerequisites: string[];
}

export interface WhatsAppStatusResponse {
  connected: boolean;
  status: string;
  healthStatus: string;
  apiStatus?: string;
  webhookStatus?: WhatsAppWebhookStatus | string;
  businessPhoneNumber: string;
  verifiedName?: string;
  phoneNumberId: string;
  businessAccountId: string;
  wabaName?: string;
  coexistenceMode?: boolean;
  onboardingType?: string;
  verificationChecks?: WhatsAppVerificationChecks | null;
  connectedByName?: string;
  connectedAt?: string;
  lastHealthCheckAt?: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  error?: string;
}

async function getAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Proceeding cleanly; backend validates session when required
  }
  return headers;
}

export async function fetchEmbeddedSignupConfig(
  restaurantId?: string
): Promise<EmbeddedSignupConfigResponse> {
  const headers = await getAuthHeaders(false);
  const query = restaurantId
    ? `?restaurantId=${encodeURIComponent(restaurantId)}`
    : '';
  const res = await fetch(`/api/whatsapp/embedded-signup/config${query}`, {
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to inspect Meta Embedded Signup configuration');
  }
  return res.json();
}

export async function completeEmbeddedSignupApi(payload: {
  restaurantId: string;
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  eventType?: string;
  coexistenceRequested?: boolean;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<WhatsAppStatusResponse & { success: boolean; message?: string }> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/whatsapp/embedded-signup/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.status !== 'ACTION_REQUIRED') {
    throw new Error(data.error || 'Failed to complete Meta WhatsApp Embedded Signup');
  }
  return data;
}

export async function fetchWhatsAppStatus(restaurantId: string): Promise<WhatsAppStatusResponse> {
  const headers = await getAuthHeaders(false);
  const res = await fetch(
    `/api/whatsapp/status?restaurantId=${encodeURIComponent(restaurantId)}`,
    { headers }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch WhatsApp status');
  }
  return res.json();
}

export async function disconnectWhatsAppApi(payload: {
  restaurantId: string;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<{ success: boolean; message: string }> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/whatsapp/disconnect', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to disconnect WhatsApp');
  }
  return data;
}

export async function sendPoViaWhatsAppApi(payload: {
  restaurantId: string;
  purchaseOrderId: string;
  vendorId?: string;
  vendorPhone?: string;
  messageBody?: string;
  po?: import('../types').PurchaseOrder;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<{ success: boolean; messageId: string; status: string; recipientPhone: string }> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/whatsapp/send-po', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Failed to send Purchase Order via WhatsApp');
    (error as any).code = data.code;
    throw error;
  }
  return data;
}

export async function sendTestWhatsAppMessageApi(payload: {
  restaurantId: string;
  recipientPhone: string;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<{ success: boolean; messageId: string; recipientPhone: string }> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/whatsapp/test-message', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to send test message');
  }
  return data;
}

export async function fetchWhatsAppMessageHistory(
  restaurantId: string,
  purchaseOrderId?: string
): Promise<WhatsAppMessageRecord[]> {
  const headers = await getAuthHeaders(false);
  let url = `/api/whatsapp/history?restaurantId=${encodeURIComponent(restaurantId)}`;
  if (purchaseOrderId) {
    url += `&purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.messages || [];
}
