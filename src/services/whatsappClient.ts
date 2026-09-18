import { WhatsAppSettings, WhatsAppMessageRecord } from '../types';

export interface WhatsAppStatusResponse {
  connected: boolean;
  status: string;
  healthStatus: string;
  businessPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  connectedByName?: string;
  connectedAt?: string;
  lastHealthCheckAt?: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  error?: string;
}

export async function fetchWhatsAppStatus(restaurantId: string): Promise<WhatsAppStatusResponse> {
  const res = await fetch(`/api/whatsapp/status?restaurantId=${encodeURIComponent(restaurantId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch WhatsApp status');
  }
  return res.json();
}

export async function connectWhatsAppApi(payload: {
  restaurantId: string;
  businessPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken?: string;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/whatsapp/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to connect WhatsApp Business account');
  }
  return data;
}

export async function disconnectWhatsAppApi(payload: {
  restaurantId: string;
  userUid: string;
  userName: string;
  userRole: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/whatsapp/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
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
  const res = await fetch('/api/whatsapp/send-po', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
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
  const res = await fetch('/api/whatsapp/test-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to send test message');
  }
  return data;
}

export async function fetchWhatsAppMessageHistory(
  restaurantId: string,
  purchaseOrderId?: string
): Promise<WhatsAppMessageRecord[]> {
  let url = `/api/whatsapp/history?restaurantId=${encodeURIComponent(restaurantId)}`;
  if (purchaseOrderId) {
    url += `&purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.messages || [];
}
