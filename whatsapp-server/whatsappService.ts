import crypto from 'crypto';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import { db } from '../src/firebase/config';
import {
  WhatsAppConfig,
  WhatsAppMessageRecord,
  WhatsAppConnectionStatus,
  WhatsAppHealthStatus,
} from './types';
import { PurchaseOrder, Vendor, Restaurant } from '../src/types';

// In-memory server-side secret vault for restaurant custom tokens (isolated per tenant, never exposed to client)
const tenantTokenVault = new Map<string, string>();

// Multi-tenant mappings for phone number ID and business account ID to restaurant ID
const phoneNumberToRestaurantMap = new Map<string, string>();
const businessAccountToRestaurantMap = new Map<string, string>();

export function registerRestaurantWhatsAppMapping(
  restaurantId: string,
  phoneNumberId?: string,
  businessAccountId?: string
) {
  if (phoneNumberId && phoneNumberId.trim()) {
    phoneNumberToRestaurantMap.set(phoneNumberId.trim(), restaurantId);
  }
  if (businessAccountId && businessAccountId.trim()) {
    businessAccountToRestaurantMap.set(businessAccountId.trim(), restaurantId);
  }
}

/**
 * Resolves the restaurant ID for incoming Meta WhatsApp events multi-tenant safely.
 * Never blindly trusts payload restaurantId. Uses verified phone number ID / business account mapping.
 */
export async function resolveRestaurantForMetaEvent(params: {
  phoneNumberId?: string;
  businessAccountId?: string;
  messageId?: string;
}): Promise<string | null> {
  const { phoneNumberId, businessAccountId, messageId } = params;

  // 1. Fast cache check
  if (phoneNumberId && phoneNumberToRestaurantMap.has(phoneNumberId.trim())) {
    return phoneNumberToRestaurantMap.get(phoneNumberId.trim())!;
  }
  if (businessAccountId && businessAccountToRestaurantMap.has(businessAccountId.trim())) {
    return businessAccountToRestaurantMap.get(businessAccountId.trim())!;
  }

  // 2. Query Firestore restaurants settings
  try {
    const restaurantsCol = collection(db, 'restaurants');
    const restSnap = await getDocs(restaurantsCol);

    for (const rDoc of restSnap.docs) {
      const restId = rDoc.id;
      const settingsRef = doc(db, 'restaurants', restId, 'settings', 'whatsapp');
      const settingsSnap = await getDoc(settingsRef);

      if (settingsSnap.exists()) {
        const data = settingsSnap.data() as WhatsAppConfig;
        if (data.phoneNumberId) {
          phoneNumberToRestaurantMap.set(data.phoneNumberId.trim(), restId);
        }
        if (data.businessAccountId) {
          businessAccountToRestaurantMap.set(data.businessAccountId.trim(), restId);
        }

        if (
          (phoneNumberId && data.phoneNumberId === phoneNumberId.trim()) ||
          (businessAccountId && data.businessAccountId === businessAccountId.trim())
        ) {
          return restId;
        }
      }
    }

    // 3. Fallback: if messageId provided, check if message belongs to a restaurant
    if (messageId) {
      for (const rDoc of restSnap.docs) {
        const restId = rDoc.id;
        const msgRef = doc(db, 'restaurants', restId, 'whatsappMessages', messageId);
        const msgSnap = await getDoc(msgRef);
        if (msgSnap.exists()) {
          return restId;
        }
      }
    }
  } catch (err) {
    console.error('Error resolving restaurant for WhatsApp event:', err);
  }

  return null;
}

/**
 * Cryptographically verifies Meta X-Hub-Signature-256 header using WHATSAPP_APP_SECRET
 */
export function verifyMetaWebhookSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
  appSecret: string
): { valid: boolean; reason?: string } {
  if (!signatureHeader || !signatureHeader.trim()) {
    return { valid: false, reason: 'Missing X-Hub-Signature-256 header' };
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return { valid: false, reason: 'Invalid signature format. Expected sha256=<hash>' };
  }

  const hash = parts[1].trim();
  if (!hash) {
    return { valid: false, reason: 'Empty signature hash' };
  }

  const payload: Buffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === 'string' ? rawBody : '', 'utf8');
  const expectedHash = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
  const expectedSignature = `sha256=${expectedHash}`;

  const sigBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expBuf.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'Cryptographic signature mismatch' };
  }

  return { valid: true };
}

export function setTenantSecureToken(restaurantId: string, token: string) {
  if (token && token.trim()) {
    tenantTokenVault.set(restaurantId, token.trim());
  }
}

export function getTenantSecureToken(restaurantId: string): string | null {
  const custom = tenantTokenVault.get(restaurantId);
  if (custom) return custom;
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

export function removeTenantSecureToken(restaurantId: string) {
  tenantTokenVault.delete(restaurantId);
}

/**
 * Normalizes phone numbers with strict Indian mobile phone rules (+91).
 * Never blindly appends 91 if already present.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new Error('Vendor WhatsApp number is missing.');
  }

  // Remove all non-numeric characters
  const cleaned = rawPhone.replace(/\D/g, '');

  if (!cleaned || cleaned.length < 10) {
    throw new Error('Invalid WhatsApp number. Number must be at least 10 digits.');
  }

  // Standard Indian 10-digit mobile number starting with 6, 7, 8, or 9
  if (cleaned.length === 10) {
    if (!/^[6-9]\d{9}$/.test(cleaned)) {
      throw new Error(`Invalid Indian mobile number: ${cleaned}. Must start with 6, 7, 8, or 9.`);
    }
    return `91${cleaned}`;
  }

  // 11 digits starting with 0 (e.g., 09876543210)
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    const withoutZero = cleaned.slice(1);
    if (!/^[6-9]\d{9}$/.test(withoutZero)) {
      throw new Error(`Invalid mobile number after removing leading zero: ${cleaned}`);
    }
    return `91${withoutZero}`;
  }

  // 12 digits starting with 91 (e.g., 919876543210)
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    const nationalNumber = cleaned.slice(2);
    if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
      throw new Error(`Invalid Indian mobile number after 91 prefix: ${nationalNumber}`);
    }
    return cleaned;
  }

  // International standard E.164 without leading plus (11 to 15 digits)
  if (cleaned.length >= 11 && cleaned.length <= 15) {
    return cleaned;
  }

  throw new Error(`Invalid phone number length (${cleaned.length} digits). Expected 10 to 15 digits.`);
}

/**
 * Generates exact professional PO message matching specification:
 * Purchase Order
 * Restaurant: {restaurantName}
 * PO Number: {poNumber}
 * Date: {date}
 * Vendor: {vendorName}
 * Items:
 * 1. Rice
 * Qty: 25 Kg
 * Estimated Rate: ₹140
 * Estimated Amount: ₹3,500
 * ...
 */
export function generatePoMessageText(
  po: PurchaseOrder,
  restaurantName: string,
  vendorName: string,
  currencySymbol = '₹'
): string {
  const poDate = po.createdAt ? new Date(po.createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');

  let itemsText = '';
  po.items.forEach((item, index) => {
    const qty = item.orderedQty ?? item.recommendedQuantity ?? 0;
    const rate = item.estimatedRate ?? 0;
    const amount = Number((qty * rate).toFixed(2));
    itemsText += `${index + 1}. ${item.itemName}\nQty: ${qty} ${item.unit}\nEstimated Rate: ${currencySymbol}${rate.toLocaleString()}\nEstimated Amount: ${currencySymbol}${amount.toLocaleString()}\n\n`;
  });

  const total = (po.estimatedTotal ?? po.totalEstimatedAmount ?? 0).toLocaleString();

  return `Purchase Order

Restaurant:
${restaurantName}

PO Number:
${po.poNumber}

Date:
${poDate}

Vendor:
${vendorName}

Items:

${itemsText.trim()}

Total Estimated Amount:
${currencySymbol}${total}

Please confirm availability and expected delivery.

Regards,
${restaurantName}`;
}

/**
 * Verifies credentials against Meta Graph API
 */
export async function verifyMetaCredentials(
  phoneNumberId: string,
  accessToken: string
): Promise<{ ok: boolean; verifiedName?: string; displayPhoneNumber?: string; error?: string }> {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.error?.message || `Meta Graph API returned status ${res.status}`,
      };
    }

    return {
      ok: true,
      verifiedName: data.verified_name || '',
      displayPhoneNumber: data.display_phone_number || '',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dispatches an official WhatsApp Cloud API message
 */
export async function sendMetaCloudApiMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<{ messageId: string }> {
  const url = `https://graph.facebook.com/v21.0/${params.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'text',
    text: {
      preview_url: false,
      body: params.body,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg = data.error?.message || `WhatsApp Cloud API error (${response.status})`;
    const errCode = data.error?.code ? `Code ${data.error.code}: ` : '';
    const errSubcode = data.error?.error_subcode ? ` (Subcode ${data.error.error_subcode})` : '';
    throw new Error(`${errCode}${errMsg}${errSubcode}`);
  }

  const messageId = data.messages?.[0]?.id;
  if (!messageId) {
    throw new Error('WhatsApp Cloud API did not return a valid message ID');
  }

  return { messageId };
}

/**
 * Writes an immutable audit log record to Firestore
 */
export async function recordWhatsAppAuditLog(params: {
  restaurantId: string;
  actorUid: string;
  actorName: string;
  action: string;
  entityId?: string;
  details?: string;
}) {
  try {
    const logRef = doc(collection(db, 'restaurants', params.restaurantId, 'auditLogs'));
    await setDoc(logRef, {
      id: logRef.id,
      actorUid: params.actorUid,
      actorName: params.actorName,
      action: params.action,
      entity: 'WHATSAPP',
      entityId: params.entityId || '',
      details: params.details || '',
      restaurantId: params.restaurantId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write WhatsApp audit log:', err);
  }
}

/**
 * Loads the restaurant's WhatsApp settings from Firestore
 */
export async function getRestaurantWhatsAppConfig(restaurantId: string): Promise<WhatsAppConfig | null> {
  const settingsDocRef = doc(db, 'restaurants', restaurantId, 'settings', 'whatsapp');
  const snap = await getDoc(settingsDocRef);
  if (!snap.exists()) {
    return null;
  }
  return snap.data() as WhatsAppConfig;
}

/**
 * Saves or updates the restaurant's WhatsApp settings in Firestore
 */
export async function saveRestaurantWhatsAppConfig(
  restaurantId: string,
  config: Partial<WhatsAppConfig>
): Promise<void> {
  const settingsDocRef = doc(db, 'restaurants', restaurantId, 'settings', 'whatsapp');
  await setDoc(settingsDocRef, config, { merge: true });
  registerRestaurantWhatsAppMapping(restaurantId, config.phoneNumberId, config.businessAccountId);
}

/**
 * Checks overall health of restaurant's WhatsApp connection
 */
export async function checkWhatsAppHealth(restaurantId: string): Promise<{
  connected: boolean;
  status: WhatsAppConnectionStatus;
  healthStatus: WhatsAppHealthStatus;
  businessPhoneNumber?: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  lastHealthCheckAt?: string;
  error?: string;
}> {
  const config = await getRestaurantWhatsAppConfig(restaurantId);

  if (!config || !config.connected) {
    return {
      connected: false,
      status: 'DISCONNECTED',
      healthStatus: 'DISCONNECTED',
      businessPhoneNumber: config?.businessPhoneNumber || '',
      lastWebhookAt: config?.lastWebhookAt,
      lastSuccessfulMessageAt: config?.lastSuccessfulMessageAt,
      lastHealthCheckAt: new Date().toISOString(),
    };
  }

  const token = getTenantSecureToken(restaurantId);
  if (!token) {
    return {
      connected: false,
      status: 'AUTH_ERROR',
      healthStatus: 'UNHEALTHY',
      businessPhoneNumber: config.businessPhoneNumber,
      lastHealthCheckAt: new Date().toISOString(),
      error: 'WhatsApp Business API access token is missing on server.',
    };
  }

  const metaCheck = await verifyMetaCredentials(config.phoneNumberId, token);
  const now = new Date().toISOString();

  if (!metaCheck.ok) {
    await saveRestaurantWhatsAppConfig(restaurantId, {
      status: 'AUTH_ERROR',
      healthStatus: 'UNHEALTHY',
      lastError: metaCheck.error,
      lastHealthCheckAt: now,
    });

    return {
      connected: false,
      status: 'AUTH_ERROR',
      healthStatus: 'UNHEALTHY',
      businessPhoneNumber: config.businessPhoneNumber,
      lastHealthCheckAt: now,
      error: metaCheck.error,
    };
  }

  await saveRestaurantWhatsAppConfig(restaurantId, {
    status: 'CONNECTED',
    healthStatus: 'HEALTHY',
    lastHealthCheckAt: now,
    lastError: '',
  });

  return {
    connected: true,
    status: 'CONNECTED',
    healthStatus: 'HEALTHY',
    businessPhoneNumber: config.businessPhoneNumber,
    lastWebhookAt: config.lastWebhookAt,
    lastSuccessfulMessageAt: config.lastSuccessfulMessageAt,
    lastHealthCheckAt: now,
  };
}
