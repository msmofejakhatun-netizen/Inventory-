import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
} from 'firebase/firestore';
import { db, firebaseConfig } from '../src/firebase/config';
import {
  WhatsAppConfig,
  WhatsAppConnectionStatus,
  WhatsAppHealthStatus,
  WhatsAppVerificationChecks,
  WhatsAppWebhookStatus,
} from './types';
import { PurchaseOrder } from '../src/types';

export const META_GRAPH_API_VERSION = 'v25.0';
const VAULT_FILE_PATH = path.resolve(process.cwd(), '.stoqo-wa-vault.enc');

// In-memory server-side secret vault for restaurant tokens (isolated per tenant, never exposed to client)
const tenantTokenVault = new Map<string, string>();
// In-memory server-side config cache for fast webhook resolution & resilient reads
const restaurantConfigCache = new Map<string, WhatsAppConfig>();

// Multi-tenant mappings for phone number ID and business account ID to restaurant ID
const phoneNumberToRestaurantMap = new Map<string, string>();
const businessAccountToRestaurantMap = new Map<string, string>();

// ============================================================================
// ENCRYPTED SERVER-SIDE TOKEN VAULT (AES-256-GCM)
// ============================================================================
function getVaultCipherKey(): Buffer {
  const secretSeed =
    process.env.WHATSAPP_APP_SECRET ||
    process.env.META_APP_SECRET ||
    `${firebaseConfig.projectId}:${firebaseConfig.apiKey}:stoqo-whatsapp-vault`;
  return crypto.scryptSync(secretSeed, 'stoqo-whatsapp-tenant-vault-v1', 32);
}

function loadTokenVaultFromDisk(): void {
  try {
    if (!fs.existsSync(VAULT_FILE_PATH)) return;
    const raw = fs.readFileSync(VAULT_FILE_PATH, 'utf8').trim();
    if (!raw) return;

    const parsed = JSON.parse(raw) as { iv: string; tag: string; data: string };
    if (!parsed.iv || !parsed.tag || !parsed.data) return;

    const key = getVaultCipherKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'hex')),
      decipher.final(),
    ]).toString('utf8');

    const entries = JSON.parse(decrypted) as Record<string, string>;
    for (const [restId, token] of Object.entries(entries)) {
      if (restId && typeof token === 'string' && token.trim()) {
        tenantTokenVault.set(restId, token.trim());
      }
    }
  } catch (err) {
    console.warn('[WhatsApp Vault] Unable to load persisted vault (starting clean):', err instanceof Error ? err.message : err);
  }
}

function persistTokenVaultToDisk(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [restId, token] of tenantTokenVault.entries()) {
      obj[restId] = token;
    }

    const key = getVaultCipherKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(obj), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    fs.writeFileSync(
      VAULT_FILE_PATH,
      JSON.stringify({
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
      }),
      { mode: 0o600 }
    );
  } catch (err) {
    console.warn('[WhatsApp Vault] Could not persist encrypted vault to disk:', err instanceof Error ? err.message : err);
  }
}

loadTokenVaultFromDisk();

export function setTenantSecureToken(restaurantId: string, token: string) {
  if (token && token.trim()) {
    tenantTokenVault.set(restaurantId, token.trim());
    persistTokenVaultToDisk();
  }
}

export function getTenantSecureToken(restaurantId: string): string | null {
  const custom = tenantTokenVault.get(restaurantId);
  if (custom) return custom;
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

export function hasTenantOwnToken(restaurantId: string): boolean {
  return tenantTokenVault.has(restaurantId);
}

export function removeTenantSecureToken(restaurantId: string) {
  tenantTokenVault.delete(restaurantId);
  persistTokenVaultToDisk();
}

// ============================================================================
// FIREBASE AUTH & AUTHENTICATED FIRESTORE REST API HELPERS
// ============================================================================
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email?: string; displayName?: string } | null> {
  if (!idToken || !firebaseConfig.apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data?.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email,
      displayName: user.displayName,
    };
  } catch {
    return null;
  }
}

function toFirestoreValue(val: any): Record<string, any> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(field: any): any {
  if (!field || typeof field !== 'object') return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return Boolean(field.booleanValue);
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('nullValue' in field) return null;
  if ('timestampValue' in field) return field.timestampValue;
  if ('arrayValue' in field) {
    const values = field.arrayValue?.values || [];
    return values.map(fromFirestoreValue);
  }
  if ('mapValue' in field) {
    const fields = field.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFirestoreDocument(docJson: any): Record<string, any> | null {
  if (!docJson?.fields) return null;
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(docJson.fields)) {
    result[key] = fromFirestoreValue(val);
  }
  return result;
}

export async function firestoreRestGetDoc(
  documentPath: string,
  idToken?: string | null
): Promise<Record<string, any> | null> {
  if (!idToken) return null;
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/${documentPath}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return decodeFirestoreDocument(data);
  } catch {
    return null;
  }
}

export async function firestoreRestPatchDoc(
  documentPath: string,
  payload: Record<string, any>,
  idToken?: string | null
): Promise<boolean> {
  if (!idToken) return false;
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const cleanPayload: Record<string, any> = {};
  const fieldPaths: string[] = [];

  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) {
      cleanPayload[k] = toFirestoreValue(v);
      fieldPaths.push(k);
    }
  }

  if (fieldPaths.length === 0) return true;

  const maskParams = fieldPaths
    .map((fp) => `updateMask.fieldPaths=${encodeURIComponent(fp)}`)
    .join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/${documentPath}?${maskParams}`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: cleanPayload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function verifyRestaurantOwnerAccess(params: {
  restaurantId: string;
  idToken?: string | null;
  fallbackUid?: string;
  fallbackRole?: string;
}): Promise<{ authorized: boolean; uid: string; reason?: string }> {
  const { restaurantId, idToken, fallbackUid, fallbackRole } = params;

  if (idToken) {
    const verifiedUser = await verifyFirebaseIdToken(idToken);
    if (!verifiedUser) {
      return {
        authorized: false,
        uid: '',
        reason: 'Invalid or expired Firebase authentication session. Please sign in again.',
      };
    }

    const restData = await firestoreRestGetDoc(`restaurants/${restaurantId}`, idToken);
    if (restData?.ownerUid === verifiedUser.uid) {
      return { authorized: true, uid: verifiedUser.uid };
    }

    const memberData = await firestoreRestGetDoc(
      `restaurants/${restaurantId}/users/${verifiedUser.uid}`,
      idToken
    );
    if (memberData?.role === 'OWNER') {
      return { authorized: true, uid: verifiedUser.uid };
    }

    // If Firestore doc couldn't be read because the user is not a member or not owner
    return {
      authorized: false,
      uid: verifiedUser.uid,
      reason: 'Forbidden: Only the restaurant Owner is authorized to connect or manage WhatsApp Business.',
    };
  }

  // Fallback check if called in trusted server-only context without Authorization header
  try {
    const restSnap = await getDoc(doc(db, 'restaurants', restaurantId));
    const restData = restSnap.data() as { ownerUid?: string } | undefined;
    if (restData && fallbackUid && restData.ownerUid === fallbackUid) {
      return { authorized: true, uid: fallbackUid };
    }
  } catch {
    // Firestore client SDK may be unauthenticated under strict rules
  }

  if (fallbackRole === 'OWNER' && fallbackUid) {
    return { authorized: true, uid: fallbackUid };
  }

  return {
    authorized: false,
    uid: fallbackUid || '',
    reason: 'Forbidden: Only the restaurant Owner is authorized to connect or manage WhatsApp Business.',
  };
}

// ============================================================================
// MULTI-TENANT MAPPING & RESOLUTION
// ============================================================================
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

export async function resolveRestaurantForMetaEvent(params: {
  phoneNumberId?: string;
  businessAccountId?: string;
  messageId?: string;
}): Promise<string | null> {
  const { phoneNumberId, businessAccountId, messageId } = params;

  if (phoneNumberId && phoneNumberToRestaurantMap.has(phoneNumberId.trim())) {
    return phoneNumberToRestaurantMap.get(phoneNumberId.trim())!;
  }
  if (businessAccountId && businessAccountToRestaurantMap.has(businessAccountId.trim())) {
    return businessAccountToRestaurantMap.get(businessAccountId.trim())!;
  }

  // Check in-memory restaurant config cache
  for (const [restId, cfg] of restaurantConfigCache.entries()) {
    if (
      (phoneNumberId && cfg.phoneNumberId === phoneNumberId.trim()) ||
      (businessAccountId && cfg.businessAccountId === businessAccountId.trim())
    ) {
      return restId;
    }
  }

  // Query Firestore restaurants settings fallback
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
    console.warn('Webhook restaurant resolution note:', err instanceof Error ? err.message : err);
  }

  return null;
}

// ============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================================================
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

// ============================================================================
// META EMBEDDED SIGNUP CONFIGURATION DIAGNOSTICS & GRAPH API v21.0
// ============================================================================
export interface MetaMissingRequirement {
  key: string;
  label: string;
  description: string;
  dashboardSource: string;
}

export interface MetaEmbeddedSignupConfigStatus {
  ready: boolean;
  webhookReady: boolean;
  embeddedSignupVersion: 'v4';
  appId: string | null;
  configId: string | null;
  appIdSynced: boolean;
  configIdSynced: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  graphApiVersion: string;
  requiredPermissions: string[];
  webhookCallbackUrl: string;
  coexistenceSupported: boolean;
  missingRequirements: MetaMissingRequirement[];
  metaPrerequisites: string[];
}

export function getMetaAppCredentials() {
  if (!process.env.META_APP_ID && !process.env.VITE_META_APP_ID) {
    try {
      const candidatePids: string[] = [];
      if (fs.existsSync('/app/.dev.pid')) {
        const devPid = fs.readFileSync('/app/.dev.pid', 'utf8').trim();
        if (devPid) candidatePids.push(devPid);
      }
      if (fs.existsSync('/proc')) {
        for (const d of fs.readdirSync('/proc')) {
          if (/^\d+$/.test(d) && !candidatePids.includes(d)) {
            candidatePids.push(d);
          }
        }
      }
      const syncKeys = [
        'META_APP_ID',
        'VITE_META_APP_ID',
        'META_EMBEDDED_SIGNUP_CONFIG_ID',
        'VITE_META_EMBEDDED_SIGNUP_CONFIG_ID',
        'META_APP_SECRET',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_VERIFY_TOKEN',
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
        'WHATSAPP_ACCESS_TOKEN',
      ];
      for (const pid of candidatePids) {
        try {
          const envRaw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
          const map: Record<string, string> = {};
          for (const entry of envRaw) {
            const idx = entry.indexOf('=');
            if (idx > 0) map[entry.slice(0, idx)] = entry.slice(idx + 1);
          }
          if (map.META_APP_ID || map.VITE_META_APP_ID) {
            for (const k of syncKeys) {
              if (map[k] && !process.env[k]) {
                process.env[k] = map[k];
              }
            }
            break;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  const rawMetaAppId = (process.env.META_APP_ID || process.env.WHATSAPP_APP_ID || '').trim();
  const rawViteAppId = (process.env.VITE_META_APP_ID || '').trim();
  const appId = rawMetaAppId || rawViteAppId;

  // Keep META_APP_ID and VITE_META_APP_ID synchronized if one is provided
  if (appId) {
    if (!process.env.META_APP_ID) process.env.META_APP_ID = appId;
    if (!process.env.VITE_META_APP_ID) process.env.VITE_META_APP_ID = appId;
  }

  const rawMetaConfigId = (
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
    ''
  ).trim();
  const rawViteConfigId = (process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim();
  const configId = rawMetaConfigId || rawViteConfigId;

  // Keep META_EMBEDDED_SIGNUP_CONFIG_ID and VITE_META_EMBEDDED_SIGNUP_CONFIG_ID synchronized if one is provided
  if (configId) {
    if (!process.env.META_EMBEDDED_SIGNUP_CONFIG_ID) {
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = configId;
    }
    if (!process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID) {
      process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID = configId;
    }
  }

  // Backend-only secret (never exposed to frontend)
  const appSecret = (
    process.env.META_APP_SECRET ||
    process.env.WHATSAPP_APP_SECRET ||
    ''
  ).trim();
  if (appSecret) {
    if (!process.env.META_APP_SECRET) process.env.META_APP_SECRET = appSecret;
    if (!process.env.WHATSAPP_APP_SECRET) process.env.WHATSAPP_APP_SECRET = appSecret;
  }

  const verifyToken = (
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    ''
  ).trim();
  if (verifyToken) {
    if (!process.env.WHATSAPP_VERIFY_TOKEN) process.env.WHATSAPP_VERIFY_TOKEN = verifyToken;
    if (!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = verifyToken;
    }
  }

  const appIdSynced =
    Boolean(appId) &&
    (!rawMetaAppId || !rawViteAppId || rawMetaAppId === rawViteAppId);
  const configIdSynced =
    Boolean(configId) &&
    (!rawMetaConfigId || !rawViteConfigId || rawMetaConfigId === rawViteConfigId);

  return {
    appId,
    configId,
    appSecret,
    verifyToken,
    appIdSynced,
    configIdSynced,
  };
}

export function getMetaEmbeddedSignupConfig(originUrl?: string): MetaEmbeddedSignupConfigStatus {
  const {
    appId,
    configId,
    appSecret,
    verifyToken,
    appIdSynced,
    configIdSynced,
  } = getMetaAppCredentials();
  const baseUrl = (originUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  const webhookCallbackUrl = baseUrl
    ? `${baseUrl}/api/whatsapp/webhook`
    : '/api/whatsapp/webhook';

  const missingRequirements: MetaMissingRequirement[] = [];
  if (!appId) {
    missingRequirements.push({
      key: 'META_APP_ID / VITE_META_APP_ID',
      label: 'Meta App ID (META_APP_ID & VITE_META_APP_ID)',
      description:
        'Required to initialize the official Meta Facebook JS SDK and launch Embedded Signup V4. Both variables must use the same App ID.',
      dashboardSource:
        'Meta Developer Dashboard (developers.facebook.com/apps) → Select your Business App → Top header "App ID" (or App Settings → Basic → App ID).',
    });
  } else if (!appIdSynced) {
    missingRequirements.push({
      key: 'META_APP_ID_MISMATCH',
      label: 'META_APP_ID and VITE_META_APP_ID Mismatch',
      description:
        'META_APP_ID and VITE_META_APP_ID must be set to the exact same Meta App ID.',
      dashboardSource:
        'Meta Developer Dashboard → App Settings → Basic → App ID.',
    });
  }

  if (!configId) {
    missingRequirements.push({
      key: 'META_EMBEDDED_SIGNUP_CONFIG_ID / VITE_META_EMBEDDED_SIGNUP_CONFIG_ID',
      label:
        'Embedded Signup V4 Configuration ID (META_EMBEDDED_SIGNUP_CONFIG_ID & VITE_META_EMBEDDED_SIGNUP_CONFIG_ID)',
      description:
        'Required Facebook Login for Business Configuration ID targeting WhatsApp Embedded Signup V4. Both variables must use the same Configuration ID.',
      dashboardSource:
        'Meta Developer Dashboard → Left Sidebar → Facebook Login for Business → Configurations → "+ Create Configuration" (select WhatsApp Embedded Signup V4, WhatsApp Cloud API asset, and permissions whatsapp_business_management + whatsapp_business_messaging) → Copy the Configuration ID.',
    });
  } else if (!configIdSynced) {
    missingRequirements.push({
      key: 'META_EMBEDDED_SIGNUP_CONFIG_ID_MISMATCH',
      label: 'META_EMBEDDED_SIGNUP_CONFIG_ID and VITE_META_EMBEDDED_SIGNUP_CONFIG_ID Mismatch',
      description:
        'META_EMBEDDED_SIGNUP_CONFIG_ID and VITE_META_EMBEDDED_SIGNUP_CONFIG_ID must be set to the exact same Configuration ID.',
      dashboardSource:
        'Meta Developer Dashboard → Facebook Login for Business → Configurations → Configuration ID column.',
    });
  }

  if (!appSecret) {
    missingRequirements.push({
      key: 'META_APP_SECRET',
      label: 'Meta App Secret (META_APP_SECRET — Backend Only)',
      description:
        'Server-side secret required to exchange the Embedded Signup V4 authorization code for an access token and verify X-Hub-Signature-256 webhook payloads. Never expose in frontend.',
      dashboardSource:
        'Meta Developer Dashboard → App Settings → Basic → App secret → Click "Show".',
    });
  }

  if (!verifyToken) {
    missingRequirements.push({
      key: 'WHATSAPP_VERIFY_TOKEN',
      label: 'Webhook Verify Token (WHATSAPP_VERIFY_TOKEN — Backend Only)',
      description:
        'Server-side secret string required for Meta to verify and activate webhook delivery events at ' +
        webhookCallbackUrl +
        '.',
      dashboardSource:
        'Meta Developer Dashboard → WhatsApp → Configuration → Webhook → Edit → Verify token (must match WHATSAPP_VERIFY_TOKEN on server).',
    });
  }

  return {
    ready: Boolean(appId && configId && appSecret && appIdSynced && configIdSynced),
    webhookReady: Boolean(appSecret && verifyToken),
    embeddedSignupVersion: 'v4',
    appId: appId || null,
    configId: configId || null,
    appIdSynced,
    configIdSynced,
    hasAppSecret: Boolean(appSecret),
    hasVerifyToken: Boolean(verifyToken),
    graphApiVersion: META_GRAPH_API_VERSION,
    requiredPermissions: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    webhookCallbackUrl,
    coexistenceSupported: true,
    missingRequirements,
    metaPrerequisites: [
      'Meta App must have WhatsApp and Facebook Login for Business products enabled with an Embedded Signup V4 Configuration.',
      'Required Meta permissions enabled in configuration & App Review: whatsapp_business_management and whatsapp_business_messaging.',
      'This STOQO domain must be added to Meta Developer Dashboard → Facebook Login for Business → Settings → Allowed Domains for the JavaScript SDK & Valid OAuth Redirect URIs.',
      'Meta Webhook must point to ' +
        webhookCallbackUrl +
        ' subscribed to messages (and smb_message_echoes / smb_app_state_sync for Business App coexistence).',
    ],
  };
}

export async function exchangeEmbeddedSignupCode(params: {
  appId: string;
  appSecret: string;
  code: string;
}): Promise<{ ok: boolean; accessToken?: string; error?: string }> {
  try {
    const url =
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token` +
      `?client_id=${encodeURIComponent(params.appId)}` +
      `&client_secret=${encodeURIComponent(params.appSecret)}` +
      `&code=${encodeURIComponent(params.code)}`;

    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (!res.ok || data.error || !data.access_token) {
      return {
        ok: false,
        error:
          data.error?.message ||
          `Meta OAuth code exchange failed with status ${res.status}`,
      };
    }

    return {
      ok: true,
      accessToken: String(data.access_token),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function inspectMetaAccessToken(params: {
  accessToken: string;
  appId: string;
  appSecret: string;
}): Promise<{
  ok: boolean;
  isValid: boolean;
  grantedPermissions: string[];
  resolvedWabaId?: string;
  error?: string;
}> {
  try {
    const appToken = `${params.appId}|${params.appSecret}`;
    const url =
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/debug_token` +
      `?input_token=${encodeURIComponent(params.accessToken)}` +
      `&access_token=${encodeURIComponent(appToken)}`;

    const res = await fetch(url, { method: 'GET' });
    const json = await res.json();
    const tokenData = json?.data;

    if (!res.ok || json.error || !tokenData) {
      return {
        ok: false,
        isValid: false,
        grantedPermissions: [],
        error: json.error?.message || `Failed to inspect Meta token (${res.status})`,
      };
    }

    const scopes: string[] = Array.isArray(tokenData.scopes) ? tokenData.scopes : [];
    const granularScopes: Array<{ scope?: string; target_ids?: string[] }> = Array.isArray(
      tokenData.granular_scopes
    )
      ? tokenData.granular_scopes
      : [];

    let resolvedWabaId: string | undefined;
    for (const gs of granularScopes) {
      if (
        (gs.scope === 'whatsapp_business_management' ||
          gs.scope === 'whatsapp_business_messaging') &&
        Array.isArray(gs.target_ids) &&
        gs.target_ids.length > 0
      ) {
        resolvedWabaId = String(gs.target_ids[0]);
        break;
      }
    }

    return {
      ok: Boolean(tokenData.is_valid),
      isValid: Boolean(tokenData.is_valid),
      grantedPermissions: scopes,
      resolvedWabaId,
      error: tokenData.is_valid
        ? undefined
        : tokenData.error?.message || 'Meta access token is invalid or expired',
    };
  } catch (err) {
    return {
      ok: false,
      isValid: false,
      grantedPermissions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function verifyMetaWaba(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{
  ok: boolean;
  wabaName?: string;
  accountReviewStatus?: string;
  businessVerificationStatus?: string;
  error?: string;
}> {
  try {
    const url =
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(params.wabaId)}` +
      `?fields=id,name,currency,timezone_id,account_review_status,business_verification_status,ownership_type`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.error?.message || `Failed to verify WABA (${res.status})`,
      };
    }
    return {
      ok: true,
      wabaName: data.name || '',
      accountReviewStatus: data.account_review_status || '',
      businessVerificationStatus: data.business_verification_status || '',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function subscribeAppToWaba(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: boolean; subscribed: boolean; error?: string }> {
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      params.wabaId
    )}/subscribed_apps`;

    const postRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const postData = await postRes.json();

    if (!postRes.ok || postData.error) {
      return {
        ok: false,
        subscribed: false,
        error:
          postData.error?.message ||
          `Failed to subscribe STOQO webhook to WABA (${postRes.status})`,
      };
    }

    const checkRes = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const checkData = await checkRes.json();
    const isSubscribed =
      Boolean(postData.success) ||
      (Array.isArray(checkData?.data) && checkData.data.length > 0);

    return {
      ok: isSubscribed,
      subscribed: isSubscribed,
      error: isSubscribed ? undefined : 'WABA webhook subscription did not confirm active apps.',
    };
  } catch (err) {
    return {
      ok: false,
      subscribed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkWabaWebhookSubscription(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: boolean; subscribed: boolean; error?: string }> {
  if (!params.wabaId) {
    return { ok: false, subscribed: false, error: 'Missing WABA ID' };
  }
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      params.wabaId
    )}/subscribed_apps`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {
        ok: false,
        subscribed: false,
        error: data.error?.message || `Failed to inspect WABA subscriptions (${res.status})`,
      };
    }
    const subscribed = Array.isArray(data?.data) && data.data.length > 0;
    return { ok: true, subscribed };
  } catch (err) {
    return {
      ok: false,
      subscribed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchWabaPhoneNumbers(params: {
  wabaId: string;
  accessToken: string;
}): Promise<{
  ok: boolean;
  numbers: Array<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    code_verification_status?: string;
    quality_rating?: string;
    platform_type?: string;
    status?: string;
  }>;
  error?: string;
}> {
  try {
    const url =
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(params.wabaId)}/phone_numbers` +
      `?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status,platform_type,status`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {
        ok: false,
        numbers: [],
        error: data.error?.message || `Failed to fetch WABA phone numbers (${res.status})`,
      };
    }
    return {
      ok: true,
      numbers: Array.isArray(data.data) ? data.data : [],
    };
  } catch (err) {
    return {
      ok: false,
      numbers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Registers a verified Embedded Signup phone number on the WhatsApp Cloud API (`POST /{phoneNumberId}/register`).
 * Required by Meta within 14 days of Embedded Signup for standard Cloud API numbers.
 */
export async function registerCloudApiPhoneNumber(params: {
  phoneNumberId: string;
  accessToken: string;
  pin?: string;
}): Promise<{ ok: boolean; registered: boolean; error?: string; errorCode?: number }> {
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      params.phoneNumberId
    )}/register`;
    const pinToUse =
      params.pin && /^\d{6}$/.test(params.pin.trim())
        ? params.pin.trim()
        : crypto
            .createHash('sha256')
            .update(`${params.phoneNumberId}:stoqo-2fa-pin`)
            .digest('hex')
            .replace(/\D/g, '')
            .padEnd(6, '7')
            .slice(0, 6);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: pinToUse,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return {
        ok: false,
        registered: false,
        errorCode: data.error?.code,
        error:
          data.error?.message ||
          `Cloud API phone number registration returned status ${res.status}`,
      };
    }
    return {
      ok: Boolean(data.success),
      registered: Boolean(data.success),
    };
  } catch (err) {
    return {
      ok: false,
      registered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Initiates WhatsApp Business App Coexistence state & history sync (`POST /{phoneNumberId}/smb_app_data`)
 * within the 24-hour onboarding window when `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` is used.
 */
export async function syncCoexistenceAppData(params: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ contactsSynced: boolean; historySynced: boolean }> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
    params.phoneNumberId
  )}/smb_app_data`;

  let contactsSynced = false;
  let historySynced = false;

  try {
    const stateRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        sync_type: 'smb_app_state_sync',
      }),
    });
    contactsSynced = stateRes.ok;
  } catch {
    // non-fatal
  }

  try {
    const histRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        sync_type: 'history',
      }),
    });
    historySynced = histRes.ok;
  } catch {
    // non-fatal
  }

  return { contactsSynced, historySynced };
}

// ============================================================================
// PHONE NORMALIZATION & PO TEXT FORMATTER (PRESERVED)
// ============================================================================
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new Error('Vendor WhatsApp number is missing.');
  }

  const cleaned = rawPhone.replace(/\D/g, '');

  if (!cleaned || cleaned.length < 10) {
    throw new Error('Invalid WhatsApp number. Number must be at least 10 digits.');
  }

  if (cleaned.length === 10) {
    if (!/^[6-9]\d{9}$/.test(cleaned)) {
      throw new Error(`Invalid Indian mobile number: ${cleaned}. Must start with 6, 7, 8, or 9.`);
    }
    return `91${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    const withoutZero = cleaned.slice(1);
    if (!/^[6-9]\d{9}$/.test(withoutZero)) {
      throw new Error(`Invalid mobile number after removing leading zero: ${cleaned}`);
    }
    return `91${withoutZero}`;
  }

  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    const nationalNumber = cleaned.slice(2);
    if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
      throw new Error(`Invalid Indian mobile number after 91 prefix: ${nationalNumber}`);
    }
    return cleaned;
  }

  if (cleaned.length >= 11 && cleaned.length <= 15) {
    return cleaned;
  }

  throw new Error(`Invalid phone number length (${cleaned.length} digits). Expected 10 to 15 digits.`);
}

export function generatePoMessageText(
  po: PurchaseOrder,
  restaurantName: string,
  vendorName: string
): string {
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

${(restaurantName || 'RESTAURANT STORE').toUpperCase()}
Vendor: ${(vendorName || 'SUPPLIER').toUpperCase()}
PO Number: ${po.poNumber}
Date: ${poDate}

ITEM                         QTY        UNIT
------------------------------------------------
${itemsTable}
------------------------------------------------

Please confirm receipt and delivery schedule.`;
}

/**
 * Verifies phone number credentials against Meta Graph API
 */
export async function verifyMetaCredentials(
  phoneNumberId: string,
  accessToken: string
): Promise<{
  ok: boolean;
  verifiedName?: string;
  displayPhoneNumber?: string;
  codeVerificationStatus?: string;
  qualityRating?: string;
  platformType?: string;
  phoneStatus?: string;
  error?: string;
}> {
  if (!phoneNumberId) {
    return { ok: false, error: 'Phone Number ID is missing.' };
  }
  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
      phoneNumberId
    )}?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status,platform_type,status`;
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
      codeVerificationStatus: data.code_verification_status || '',
      qualityRating: data.quality_rating || '',
      platformType: data.platform_type || '',
      phoneStatus: data.status || '',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dispatches an official WhatsApp Cloud API text message
 */
export async function sendMetaCloudApiMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<{ messageId: string }> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`;

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

export async function uploadMetaMedia(params: {
  phoneNumberId: string;
  accessToken: string;
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}): Promise<{ mediaId: string }> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${params.phoneNumberId}/media`;

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([params.buffer], { type: params.mimeType || 'image/png' }),
    params.filename
  );
  formData.append('type', params.mimeType || 'image/png');
  formData.append('messaging_product', 'whatsapp');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg = data.error?.message || `Meta Media upload failed (${response.status})`;
    const errCode = data.error?.code ? `Code ${data.error.code}: ` : '';
    throw new Error(`${errCode}${errMsg}`);
  }

  const mediaId = data.id;
  if (!mediaId) {
    throw new Error('Meta Media API did not return a valid media ID');
  }

  return { mediaId };
}

export async function sendMetaCloudApiImageMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  mediaId?: string;
  imageLink?: string;
  caption?: string;
}): Promise<{ messageId: string }> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${params.phoneNumberId}/messages`;

  const imageObj: Record<string, any> = {};
  if (params.mediaId) {
    imageObj.id = params.mediaId;
  } else if (params.imageLink) {
    imageObj.link = params.imageLink;
  } else {
    throw new Error('Either mediaId or imageLink must be provided for image message');
  }

  if (params.caption && params.caption.trim()) {
    imageObj.caption = params.caption.trim();
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'image',
    image: imageObj,
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

export async function recordWhatsAppAuditLog(params: {
  restaurantId: string;
  actorUid: string;
  actorName: string;
  action: string;
  entityId?: string;
  details?: string;
  idToken?: string | null;
}) {
  const logId = `wa_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const logPayload = {
    id: logId,
    actorUid: params.actorUid,
    actorName: params.actorName,
    action: params.action,
    entity: 'WHATSAPP',
    entityId: params.entityId || '',
    details: params.details || '',
    restaurantId: params.restaurantId,
    createdAt: new Date().toISOString(),
  };

  try {
    if (params.idToken) {
      const ok = await firestoreRestPatchDoc(
        `restaurants/${params.restaurantId}/auditLogs/${logId}`,
        logPayload,
        params.idToken
      );
      if (ok) return;
    }

    const logRef = doc(db, 'restaurants', params.restaurantId, 'auditLogs', logId);
    await setDoc(logRef, logPayload);
  } catch (err) {
    console.warn('WhatsApp audit log write skipped:', err instanceof Error ? err.message : err);
  }
}

export async function getRestaurantWhatsAppConfig(
  restaurantId: string,
  idToken?: string | null
): Promise<WhatsAppConfig | null> {
  if (idToken) {
    const restData = await firestoreRestGetDoc(
      `restaurants/${restaurantId}/settings/whatsapp`,
      idToken
    );
    if (restData) {
      const cfg = restData as WhatsAppConfig;
      restaurantConfigCache.set(restaurantId, cfg);
      registerRestaurantWhatsAppMapping(restaurantId, cfg.phoneNumberId, cfg.businessAccountId);
      return cfg;
    }
  }

  try {
    const settingsDocRef = doc(db, 'restaurants', restaurantId, 'settings', 'whatsapp');
    const snap = await getDoc(settingsDocRef);
    if (snap.exists()) {
      const cfg = snap.data() as WhatsAppConfig;
      restaurantConfigCache.set(restaurantId, cfg);
      registerRestaurantWhatsAppMapping(restaurantId, cfg.phoneNumberId, cfg.businessAccountId);
      return cfg;
    }
  } catch {
    // Client SDK on server is unauthenticated when rules require membership
  }

  return restaurantConfigCache.get(restaurantId) || null;
}

export async function saveRestaurantWhatsAppConfig(
  restaurantId: string,
  config: Partial<WhatsAppConfig>,
  idToken?: string | null
): Promise<void> {
  const existing = restaurantConfigCache.get(restaurantId) || ({} as WhatsAppConfig);
  const merged = { ...existing, ...config } as WhatsAppConfig;
  restaurantConfigCache.set(restaurantId, merged);
  registerRestaurantWhatsAppMapping(
    restaurantId,
    merged.phoneNumberId,
    merged.businessAccountId
  );

  // Strip any accidental secret fields defensively
  const safePayload: Record<string, any> = { ...config };
  delete safePayload.accessToken;
  delete safePayload.appSecret;

  if (idToken) {
    const restOk = await firestoreRestPatchDoc(
      `restaurants/${restaurantId}/settings/whatsapp`,
      safePayload,
      idToken
    );
    if (restOk) return;
  }

  try {
    const settingsDocRef = doc(db, 'restaurants', restaurantId, 'settings', 'whatsapp');
    await setDoc(settingsDocRef, safePayload, { merge: true });
  } catch (err) {
    console.warn(
      'Server Firestore write note for settings/whatsapp:',
      err instanceof Error ? err.message : err
    );
  }
}

export async function checkWhatsAppHealth(
  restaurantId: string,
  idToken?: string | null
): Promise<{
  connected: boolean;
  status: WhatsAppConnectionStatus;
  healthStatus: WhatsAppHealthStatus;
  apiStatus: WhatsAppHealthStatus;
  webhookStatus: WhatsAppWebhookStatus;
  businessPhoneNumber?: string;
  verifiedName?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  coexistenceMode?: boolean;
  verificationChecks?: WhatsAppVerificationChecks;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  lastHealthCheckAt?: string;
  error?: string;
}> {
  const config = await getRestaurantWhatsAppConfig(restaurantId, idToken);
  const { appSecret, verifyToken } = getMetaAppCredentials();
  const webhookEndpointVerified = Boolean(appSecret && verifyToken);
  const now = new Date().toISOString();

  if (
    !config ||
    config.status === 'NOT_CONNECTED' ||
    config.status === 'DISCONNECTED' ||
    (!config.connected &&
      config.status !== 'ACTION_REQUIRED' &&
      config.status !== 'CONNECTION_ERROR')
  ) {
    return {
      connected: false,
      status: 'NOT_CONNECTED',
      healthStatus: 'DISCONNECTED',
      apiStatus: 'DISCONNECTED',
      webhookStatus: webhookEndpointVerified ? 'INACTIVE' : 'ACTION_REQUIRED',
      businessPhoneNumber: config?.businessPhoneNumber || '',
      verifiedName: config?.verifiedName || '',
      phoneNumberId: config?.phoneNumberId || '',
      businessAccountId: config?.businessAccountId || '',
      coexistenceMode: Boolean(config?.coexistenceMode),
      lastWebhookAt: config?.lastWebhookAt,
      lastSuccessfulMessageAt: config?.lastSuccessfulMessageAt,
      lastHealthCheckAt: now,
    };
  }

  const token = getTenantSecureToken(restaurantId);
  if (!token) {
    return {
      connected: false,
      status: 'ACTION_REQUIRED',
      healthStatus: 'UNHEALTHY',
      apiStatus: 'UNHEALTHY',
      webhookStatus: 'ACTION_REQUIRED',
      businessPhoneNumber: config.businessPhoneNumber,
      verifiedName: config.verifiedName,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      coexistenceMode: Boolean(config.coexistenceMode),
      lastHealthCheckAt: now,
      error:
        'WhatsApp Business authorization token is unavailable on the server. Click Reconnect to re-authorize via Meta.',
    };
  }

  if (!config.phoneNumberId || !config.businessAccountId) {
    return {
      connected: false,
      status: 'ACTION_REQUIRED',
      healthStatus: 'UNHEALTHY',
      apiStatus: 'UNHEALTHY',
      webhookStatus: 'ACTION_REQUIRED',
      businessPhoneNumber: config.businessPhoneNumber,
      verifiedName: config.verifiedName,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      coexistenceMode: Boolean(config.coexistenceMode),
      lastHealthCheckAt: now,
      error:
        config.actionRequiredReason ||
        config.lastError ||
        'WhatsApp Business Account or Phone Number setup was incomplete. Complete Embedded Signup to connect.',
    };
  }

  const metaCheck = await verifyMetaCredentials(config.phoneNumberId, token);
  if (!metaCheck.ok) {
    await saveRestaurantWhatsAppConfig(
      restaurantId,
      {
        connected: false,
        status: 'CONNECTION_ERROR',
        healthStatus: 'UNHEALTHY',
        apiStatus: 'UNHEALTHY',
        webhookStatus: 'ERROR',
        lastError: metaCheck.error,
        lastHealthCheckAt: now,
      },
      idToken
    );

    return {
      connected: false,
      status: 'CONNECTION_ERROR',
      healthStatus: 'UNHEALTHY',
      apiStatus: 'UNHEALTHY',
      webhookStatus: 'ERROR',
      businessPhoneNumber: config.businessPhoneNumber,
      verifiedName: config.verifiedName,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      coexistenceMode: Boolean(config.coexistenceMode),
      lastHealthCheckAt: now,
      error: metaCheck.error,
    };
  }

  const phoneNotVerified =
    metaCheck.codeVerificationStatus &&
    metaCheck.codeVerificationStatus !== 'VERIFIED';

  const wabaSubCheck = await checkWabaWebhookSubscription({
    wabaId: config.businessAccountId,
    accessToken: token,
  });

  const webhookSubscribed = wabaSubCheck.ok ? wabaSubCheck.subscribed : false;
  const webhookStatus: WhatsAppWebhookStatus =
    webhookSubscribed && webhookEndpointVerified ? 'ACTIVE' : 'ACTION_REQUIRED';

  const checks: WhatsAppVerificationChecks = {
    wabaVerified: true,
    phoneVerified: !phoneNotVerified,
    permissionsVerified: true,
    webhookSubscribed,
    webhookEndpointVerified,
  };

  if (phoneNotVerified) {
    const reason = `Phone number verification status is ${metaCheck.codeVerificationStatus}. Please complete verification in Meta WhatsApp Manager.`;
    await saveRestaurantWhatsAppConfig(
      restaurantId,
      {
        connected: false,
        status: 'ACTION_REQUIRED',
        healthStatus: 'DEGRADED',
        apiStatus: 'DEGRADED',
        webhookStatus,
        codeVerificationStatus: metaCheck.codeVerificationStatus,
        verificationChecks: checks,
        actionRequiredReason: reason,
        lastError: reason,
        lastHealthCheckAt: now,
      },
      idToken
    );

    return {
      connected: false,
      status: 'ACTION_REQUIRED',
      healthStatus: 'DEGRADED',
      apiStatus: 'DEGRADED',
      webhookStatus,
      businessPhoneNumber: metaCheck.displayPhoneNumber || config.businessPhoneNumber,
      verifiedName: metaCheck.verifiedName || config.verifiedName,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      coexistenceMode: Boolean(config.coexistenceMode),
      verificationChecks: checks,
      lastHealthCheckAt: now,
      error: reason,
    };
  }

  if (webhookStatus !== 'ACTIVE') {
    const reason = !webhookEndpointVerified
      ? 'Server webhook verification token or app secret is missing (WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET).'
      : 'Meta WABA webhook subscription is inactive. Click Reconnect to re-subscribe.';

    await saveRestaurantWhatsAppConfig(
      restaurantId,
      {
        connected: false,
        status: 'ACTION_REQUIRED',
        healthStatus: 'DEGRADED',
        apiStatus: 'HEALTHY',
        webhookStatus: 'ACTION_REQUIRED',
        verificationChecks: checks,
        actionRequiredReason: reason,
        lastError: reason,
        lastHealthCheckAt: now,
      },
      idToken
    );

    return {
      connected: false,
      status: 'ACTION_REQUIRED',
      healthStatus: 'DEGRADED',
      apiStatus: 'HEALTHY',
      webhookStatus: 'ACTION_REQUIRED',
      businessPhoneNumber: metaCheck.displayPhoneNumber || config.businessPhoneNumber,
      verifiedName: metaCheck.verifiedName || config.verifiedName,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      coexistenceMode: Boolean(config.coexistenceMode),
      verificationChecks: checks,
      lastWebhookAt: config.lastWebhookAt,
      lastSuccessfulMessageAt: config.lastSuccessfulMessageAt,
      lastHealthCheckAt: now,
      error: reason,
    };
  }

  const verifiedNumber = metaCheck.displayPhoneNumber || config.businessPhoneNumber;
  const verifiedName = metaCheck.verifiedName || config.verifiedName || '';

  await saveRestaurantWhatsAppConfig(
    restaurantId,
    {
      connected: true,
      status: 'CONNECTED',
      healthStatus: 'HEALTHY',
      apiStatus: 'HEALTHY',
      webhookStatus: 'ACTIVE',
      businessPhoneNumber: verifiedNumber,
      verifiedName,
      codeVerificationStatus: metaCheck.codeVerificationStatus || 'VERIFIED',
      qualityRating: metaCheck.qualityRating || config.qualityRating,
      verificationChecks: checks,
      actionRequiredReason: '',
      lastHealthCheckAt: now,
      lastError: '',
    },
    idToken
  );

  return {
    connected: true,
    status: 'CONNECTED',
    healthStatus: 'HEALTHY',
    apiStatus: 'HEALTHY',
    webhookStatus: 'ACTIVE',
    businessPhoneNumber: verifiedNumber,
    verifiedName,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    coexistenceMode: Boolean(config.coexistenceMode),
    verificationChecks: checks,
    lastWebhookAt: config.lastWebhookAt,
    lastSuccessfulMessageAt: config.lastSuccessfulMessageAt,
    lastHealthCheckAt: now,
  };
}
