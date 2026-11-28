import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Issue } from '../types';
import { DraftIssueCartItem, MAX_ITEMS_PER_ISSUE_SESSION, roundQty } from '../utils/issueManagement';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface IssueSessionDraft {
  draftId: string;
  draftSessionId: string;
  restaurantId: string;
  actorUid: string;
  status: 'DRAFT';
  departmentId: string;
  shift: Issue['shift'];
  issueDate: string;
  selectedReceiverUid: string;
  receivedByName: string;
  searchQuery: string;
  selectedItemId: string;
  quantityInput: string;
  cartItems: DraftIssueCartItem[];
  includeManagerSignature: boolean;
  managerSignatureDataUrl: string | null;
  updatedAt: number;
  updatedAtIso: string;
}

export interface SaveDraftResult {
  ok: boolean;
  localSaved: boolean;
  cloudSaved: boolean;
  error?: string;
}

const IDB_NAME = 'stoqo_issue_drafts_v1';
const IDB_STORE = 'drafts';
const IDB_VERSION = 1;
const LS_FALLBACK_PREFIX = 'stoqo_issue_draft_v1::';
const WORKSPACE_OPEN_PREFIX = 'stoqo_issue_workspace_open_v1::';
const VALID_SHIFTS: Issue['shift'][] = ['MORNING', 'EVENING', 'NIGHT', 'GENERAL'];

export function buildDraftDocId(actorUid: string): string {
  const safeUid = String(actorUid || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `active_${safeUid}`;
}

export function buildDraftStorageKey(restaurantId: string, actorUid: string): string {
  return `${restaurantId}::${actorUid}`;
}

export function generateDraftSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `issdraft_${ts}_${rand}`;
}

/**
 * Sanitizes and clamps a draft payload so it strictly obeys Firestore rules and never contains tokens/secrets.
 */
export function sanitizeIssueSessionDraft(raw: Partial<IssueSessionDraft>): IssueSessionDraft | null {
  const restaurantId = String(raw.restaurantId || '').trim().slice(0, 128);
  const actorUid = String(raw.actorUid || '').trim().slice(0, 128);
  if (!restaurantId || !actorUid) return null;

  const draftId = buildDraftDocId(actorUid);
  const rawSessionId = String(raw.draftSessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const draftSessionId = rawSessionId.length >= 6 ? rawSessionId : generateDraftSessionId();

  const shift: Issue['shift'] = VALID_SHIFTS.includes(raw.shift as Issue['shift'])
    ? (raw.shift as Issue['shift'])
    : 'MORNING';

  const rawItems = Array.isArray(raw.cartItems) ? raw.cartItems : [];
  const seen = new Set<string>();
  const cartItems: DraftIssueCartItem[] = [];
  for (const line of rawItems) {
    if (!line || typeof line !== 'object') continue;
    const itemId = String(line.itemId || '').trim().slice(0, 128);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    const qty = Number(line.quantity);
    const safeQty = Number.isFinite(qty) && qty >= 0 ? roundQty(qty) : 0;
    const avail = Number(line.availableStock);
    const safeAvail = Number.isFinite(avail) && avail >= 0 ? roundQty(avail) : 0;
    const rate = Number(line.rate);
    const safeRate = Number.isFinite(rate) && rate >= 0 ? Number(rate.toFixed(4)) : 0;
    cartItems.push({
      itemId,
      itemName: String(line.itemName || 'Item').trim().slice(0, 150),
      unit: String(line.unit || 'PCS').trim().slice(0, 30),
      quantity: safeQty,
      availableStock: safeAvail,
      rate: safeRate,
      value: Number((safeQty * safeRate).toFixed(2)),
    });
    if (cartItems.length >= MAX_ITEMS_PER_ISSUE_SESSION) break;
  }

  let managerSignatureDataUrl: string | null = null;
  if (
    typeof raw.managerSignatureDataUrl === 'string' &&
    raw.managerSignatureDataUrl.startsWith('data:image/png;base64,') &&
    raw.managerSignatureDataUrl.length <= 130_000
  ) {
    managerSignatureDataUrl = raw.managerSignatureDataUrl;
  }

  const parsedUpdatedAt = Number(raw.updatedAt);
  const updatedAt =
    Number.isFinite(parsedUpdatedAt) && parsedUpdatedAt > 0
      ? Math.floor(parsedUpdatedAt)
      : Date.now();
  const updatedAtIso = new Date(updatedAt).toISOString().slice(0, 40);

  return {
    draftId,
    draftSessionId,
    restaurantId,
    actorUid,
    status: 'DRAFT',
    departmentId: String(raw.departmentId || '').trim().slice(0, 128),
    shift,
    issueDate: String(raw.issueDate || '').trim().slice(0, 20),
    selectedReceiverUid: String(raw.selectedReceiverUid || '').trim().slice(0, 128),
    receivedByName: String(raw.receivedByName || '').slice(0, 100),
    searchQuery: String(raw.searchQuery || '').slice(0, 150),
    selectedItemId: String(raw.selectedItemId || '').trim().slice(0, 128),
    quantityInput: String(raw.quantityInput ?? '1').slice(0, 24),
    cartItems,
    includeManagerSignature: Boolean(raw.includeManagerSignature),
    managerSignatureDataUrl,
    updatedAt,
    updatedAtIso,
  };
}

/**
 * Determines whether a draft has meaningful user progress worth restoring.
 */
export function isDraftMeaningful(
  draft: IssueSessionDraft | null | undefined,
  defaultTodayKey?: string,
  defaultDeptId?: string
): boolean {
  if (!draft || draft.status !== 'DRAFT') return false;
  if (draft.cartItems.length > 0) return true;
  if (draft.receivedByName.trim().length > 0) return true;
  if (draft.selectedItemId.trim().length > 0) return true;
  if (draft.searchQuery.trim().length > 0) return true;
  if (draft.includeManagerSignature || Boolean(draft.managerSignatureDataUrl)) return true;
  if (draft.shift !== 'MORNING') return true;
  if (defaultTodayKey && draft.issueDate && draft.issueDate !== defaultTodayKey) return true;
  if (defaultDeptId && draft.departmentId && draft.departmentId !== defaultDeptId) return true;
  return false;
}

/**
 * Picks the freshest valid unfinished draft scoped strictly to (restaurantId, actorUid).
 */
export function pickFreshestDraft(
  localDraft: IssueSessionDraft | null,
  cloudDraft: IssueSessionDraft | null,
  restaurantId: string,
  actorUid: string
): IssueSessionDraft | null {
  const validLocal =
    localDraft &&
    localDraft.status === 'DRAFT' &&
    localDraft.restaurantId === restaurantId &&
    localDraft.actorUid === actorUid
      ? localDraft
      : null;

  const validCloud =
    cloudDraft &&
    cloudDraft.status === 'DRAFT' &&
    cloudDraft.restaurantId === restaurantId &&
    cloudDraft.actorUid === actorUid
      ? cloudDraft
      : null;

  if (validLocal && validCloud) {
    return validLocal.updatedAt >= validCloud.updatedAt ? validLocal : validCloud;
  }
  return validLocal || validCloud;
}

// ============================================================================
// SAFE LOCAL PERSISTENCE (IndexedDB primary + localStorage safe fallback)
// ============================================================================

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE, { keyPath: 'storageKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeLocalStorageMirror(storageKey: string, draft: IssueSessionDraft): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    window.localStorage.setItem(`${LS_FALLBACK_PREFIX}${storageKey}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function readLocalStorageMirror(storageKey: string): IssueSessionDraft | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${LS_FALLBACK_PREFIX}${storageKey}`);
    if (!raw) return null;
    return sanitizeIssueSessionDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function removeLocalStorageMirror(storageKey: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(`${LS_FALLBACK_PREFIX}${storageKey}`);
  } catch {
    // ignore storage quota/security errors
  }
}

/**
 * Synchronous emergency flush for pagehide / beforeunload / visibilitychange.
 */
export function flushIssueDraftSync(rawDraft: Partial<IssueSessionDraft>): boolean {
  const clean = sanitizeIssueSessionDraft(rawDraft);
  if (!clean) return false;
  const storageKey = buildDraftStorageKey(clean.restaurantId, clean.actorUid);
  return writeLocalStorageMirror(storageKey, clean);
}

export async function saveIssueDraftLocal(rawDraft: Partial<IssueSessionDraft>): Promise<boolean> {
  const clean = sanitizeIssueSessionDraft(rawDraft);
  if (!clean) return false;
  const storageKey = buildDraftStorageKey(clean.restaurantId, clean.actorUid);

  // Always write synchronous localStorage mirror for instant refresh survival
  const lsOk = writeLocalStorageMirror(storageKey, clean);

  const idb = await openDraftDb();
  if (!idb) return lsOk;

  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put({ storageKey, ...clean });
      tx.oncomplete = () => {
        idb.close();
        resolve(true);
      };
      tx.onerror = () => {
        idb.close();
        resolve(lsOk);
      };
    } catch {
      try {
        idb.close();
      } catch {
        // ignore
      }
      resolve(lsOk);
    }
  });
}

export async function loadIssueDraftLocal(
  restaurantId: string,
  actorUid: string
): Promise<IssueSessionDraft | null> {
  if (!restaurantId || !actorUid) return null;
  const storageKey = buildDraftStorageKey(restaurantId, actorUid);
  const lsDraft = readLocalStorageMirror(storageKey);

  const idb = await openDraftDb();
  if (!idb) return lsDraft;

  const idbDraft = await new Promise<IssueSessionDraft | null>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(storageKey);
      req.onsuccess = () => {
        const res = req.result ? sanitizeIssueSessionDraft(req.result) : null;
        idb.close();
        resolve(res);
      };
      req.onerror = () => {
        idb.close();
        resolve(null);
      };
    } catch {
      try {
        idb.close();
      } catch {
        // ignore
      }
      resolve(null);
    }
  });

  return pickFreshestDraft(idbDraft, lsDraft, restaurantId, actorUid);
}

export async function clearIssueDraftLocal(restaurantId: string, actorUid: string): Promise<void> {
  if (!restaurantId || !actorUid) return;
  const storageKey = buildDraftStorageKey(restaurantId, actorUid);
  removeLocalStorageMirror(storageKey);

  const idb = await openDraftDb();
  if (!idb) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(storageKey);
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => {
        idb.close();
        resolve();
      };
    } catch {
      try {
        idb.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

// ============================================================================
// TENANT-ISOLATED FIRESTORE DRAFT PERSISTENCE (NEVER DEDUCTS STOCK)
// ============================================================================

export async function saveIssueDraftCloud(rawDraft: Partial<IssueSessionDraft>): Promise<boolean> {
  const clean = sanitizeIssueSessionDraft(rawDraft);
  if (!clean) return false;

  const draftRef = doc(db, 'restaurants', clean.restaurantId, 'issueDrafts', clean.draftId);
  await setDoc(draftRef, clean);
  return true;
}

export async function loadIssueDraftCloud(
  restaurantId: string,
  actorUid: string
): Promise<IssueSessionDraft | null> {
  if (!restaurantId || !actorUid) return null;
  try {
    const draftId = buildDraftDocId(actorUid);
    const draftRef = doc(db, 'restaurants', restaurantId, 'issueDrafts', draftId);
    const snap = await getDoc(draftRef);
    if (!snap.exists()) return null;
    const sanitized = sanitizeIssueSessionDraft(snap.data() as Partial<IssueSessionDraft>);
    if (!sanitized || sanitized.restaurantId !== restaurantId || sanitized.actorUid !== actorUid) {
      return null;
    }
    return sanitized;
  } catch (err) {
    console.warn('[issueDraftService] Could not read cloud draft (falling back to local):', err);
    return null;
  }
}

export async function clearIssueDraftCloud(restaurantId: string, actorUid: string): Promise<void> {
  if (!restaurantId || !actorUid) return;
  try {
    const draftId = buildDraftDocId(actorUid);
    const draftRef = doc(db, 'restaurants', restaurantId, 'issueDrafts', draftId);
    await deleteDoc(draftRef);
  } catch (err) {
    console.warn('[issueDraftService] Non-fatal cloud draft cleanup error:', err);
  }
}

// ============================================================================
// UNIFIED DUAL-LAYER API (Local IndexedDB + Cloud Firestore)
// ============================================================================

/**
 * Saves an unfinished Store to Kitchen Issue draft locally (IndexedDB + localStorage)
 * AND syncs to tenant-isolated Firestore (`/restaurants/{restaurantId}/issueDrafts/active_{uid}`).
 * NEVER deducts stock or creates permanent stock transaction records.
 */
export async function saveIssueDraft(rawDraft: Partial<IssueSessionDraft>): Promise<SaveDraftResult> {
  const clean = sanitizeIssueSessionDraft(rawDraft);
  if (!clean) {
    return { ok: false, localSaved: false, cloudSaved: false, error: 'Missing restaurant or user context.' };
  }

  const localSaved = await saveIssueDraftLocal(clean);
  let cloudSaved = false;
  let error: string | undefined;

  try {
    cloudSaved = await saveIssueDraftCloud(clean);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to sync draft to cloud.';
    console.warn('[issueDraftService] Cloud draft sync failed (local draft preserved):', err);
  }

  return {
    ok: localSaved || cloudSaved,
    localSaved,
    cloudSaved,
    error: !localSaved && !cloudSaved ? error || 'Unable to save draft.' : !cloudSaved ? error : undefined,
  };
}

/**
 * Restores the freshest valid unfinished draft for the exact (restaurantId, actorUid) session.
 * Never triggers stock deduction.
 */
export async function loadBestIssueDraft(
  restaurantId: string,
  actorUid: string
): Promise<IssueSessionDraft | null> {
  if (!restaurantId || !actorUid) return null;
  const [localDraft, cloudDraft] = await Promise.all([
    loadIssueDraftLocal(restaurantId, actorUid),
    loadIssueDraftCloud(restaurantId, actorUid),
  ]);
  const best = pickFreshestDraft(localDraft, cloudDraft, restaurantId, actorUid);
  if (best && (!localDraft || best.updatedAt > localDraft.updatedAt)) {
    void saveIssueDraftLocal(best);
  }
  return best;
}

/**
 * Clears the unfinished draft cleanly from both local storage (IndexedDB/localStorage) and Firestore.
 */
export async function clearIssueDraft(restaurantId: string, actorUid: string): Promise<void> {
  if (!restaurantId || !actorUid) return;
  await Promise.all([
    clearIssueDraftLocal(restaurantId, actorUid),
    clearIssueDraftCloud(restaurantId, actorUid),
  ]);
}

// ============================================================================
// WORKSPACE OPEN STATE FLAG (Auto-reopen after unexpected browser refresh)
// ============================================================================

export function markIssueWorkspaceOpen(
  restaurantId: string | null,
  actorUid: string | null,
  isOpen: boolean
): void {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  if (!restaurantId || !actorUid) return;
  const key = `${WORKSPACE_OPEN_PREFIX}${buildDraftStorageKey(restaurantId, actorUid)}`;
  try {
    if (isOpen) {
      window.sessionStorage.setItem(key, '1');
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

export function wasIssueWorkspaceOpen(
  restaurantId: string | null,
  actorUid: string | null
): boolean {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return false;
  if (!restaurantId || !actorUid) return false;
  const key = `${WORKSPACE_OPEN_PREFIX}${buildDraftStorageKey(restaurantId, actorUid)}`;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
