import { Issue, IssueSession, Item, UserRole } from '../types';

export type IssueDateFilterPreset = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'CUSTOM';

export interface DraftIssueCartItem {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  availableStock: number;
  rate: number;
  value: number;
}

export interface IssueDateRange {
  preset: IssueDateFilterPreset;
  startDateKey: string; // YYYY-MM-DD in restaurant timezone
  endDateKey: string; // YYYY-MM-DD in restaurant timezone
  label: string;
}

export interface DepartmentIssueSummaryRow {
  departmentId: string;
  departmentName: string;
  sessionCount: number;
  itemCount: number;
  totalValue: number;
}

export interface ShiftIssueSummaryRow {
  shift: Issue['shift'];
  shiftLabel: string;
  sessionCount: number;
  itemCount: number;
  totalValue: number;
}

export interface IssueDateValidationResult {
  valid: boolean;
  error: string | null;
  normalizedDateKey: string;
  todayDateKey: string;
  isBackdated: boolean;
}

export const MAX_ITEMS_PER_ISSUE_SESSION = 50;
export const MAX_SIGNATURE_DATA_URL_LENGTH = 130_000;

export const SHIFT_LABELS: Record<Issue['shift'], string> = {
  MORNING: 'Morning Shift',
  EVENING: 'Evening Shift',
  NIGHT: 'Night Shift',
  GENERAL: 'General Store',
};

export function formatShiftLabel(shift: Issue['shift'] | string): string {
  return SHIFT_LABELS[shift as Issue['shift']] || shift;
}

export function roundQty(val: number): number {
  return Number((Number.isFinite(val) ? val : 0).toFixed(2));
}

export function formatQty(val: number): string {
  const rounded = roundQty(val);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function getEffectiveItemWacRate(item: Pick<Item, 'averageStockRate' | 'lastPurchaseRate'>): number {
  const rate = Number(item.averageStockRate || item.lastPurchaseRate || 0);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

/**
 * Resolves a safe IANA timezone string, falling back to Asia/Kolkata if invalid.
 */
export function resolveSafeTimeZone(timeZone?: string | null): string {
  const candidate = (timeZone || '').trim() || 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'Asia/Kolkata';
  }
}

/**
 * Returns local calendar date key `YYYY-MM-DD` for an ISO timestamp or Date in the restaurant's timezone.
 */
export function getLocalDateKey(dateInput: Date | string, timeZone?: string | null): string {
  const tz = resolveSafeTimeZone(timeZone);
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) {
    return getLocalDateKey(new Date(), tz);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

/**
 * Returns local 24h time string `HH:mm` in the restaurant's timezone.
 */
export function getLocalTimeString(dateInput: Date | string, timeZone?: string | null): string {
  const tz = resolveSafeTimeZone(timeZone);
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '00:00';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

/**
 * Formats an ISO timestamp for display in the restaurant's local timezone.
 */
export function formatDateTimeInTimeZone(
  dateInput: Date | string,
  timeZone?: string | null
): string {
  const tz = resolveSafeTimeZone(timeZone);
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return String(dateInput || '');
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Formats a `YYYY-MM-DD` calendar key into a human-readable date string (e.g., "24 Nov 2026").
 */
export function formatDateKeyReadable(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateKey || '').trim());
  if (!match) return dateKey;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(utcDate);
}

/**
 * Shifts a `YYYY-MM-DD` calendar date key by a signed number of days cleanly without DST issues.
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + deltaDays);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Validates a `YYYY-MM-DD` calendar date string strictly against real calendar dates
 * (rejects non-existent dates like 2026-02-30 or 2026-13-01).
 */
export function isValidCalendarDateKey(dateKey: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateKey || '').trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() + 1 === month &&
    utc.getUTCDate() === day
  );
}

/**
 * Validates a manually selected Store to Kitchen Issue Date against the restaurant's local timezone.
 * - Rejects blank, malformed, or invalid calendar dates
 * - Rejects future dates (> restaurant local today)
 * - Flags past dates (< restaurant local today) as backdated entries
 */
export function validateSelectedIssueDate(
  selectedDateKey: string | null | undefined,
  timeZone?: string | null,
  referenceDate: Date = new Date()
): IssueDateValidationResult {
  const tz = resolveSafeTimeZone(timeZone);
  const todayDateKey = getLocalDateKey(referenceDate, tz);
  const cleaned = (selectedDateKey || '').trim();

  if (!cleaned) {
    return {
      valid: false,
      error: 'Issue Date is required. Please select a valid date.',
      normalizedDateKey: todayDateKey,
      todayDateKey,
      isBackdated: false,
    };
  }

  if (!isValidCalendarDateKey(cleaned)) {
    return {
      valid: false,
      error: 'Please enter a valid Issue Date (YYYY-MM-DD).',
      normalizedDateKey: todayDateKey,
      todayDateKey,
      isBackdated: false,
    };
  }

  if (cleaned > todayDateKey) {
    return {
      valid: false,
      error: `Future Issue Dates are not allowed. Please select ${formatDateKeyReadable(todayDateKey)} or an earlier date.`,
      normalizedDateKey: cleaned,
      todayDateKey,
      isBackdated: false,
    };
  }

  return {
    valid: true,
    error: null,
    normalizedDateKey: cleaned,
    todayDateKey,
    isBackdated: cleaned < todayDateKey,
  };
}

/**
 * Determines whether an IssueSession was recorded as a backdated entry
 * (selected Issue Date is strictly earlier than the local calendar date of entry creation).
 */
export function isIssueSessionBackdated(
  session: Pick<IssueSession, 'issueDate' | 'createdAt' | 'timezone' | 'isBackdated'>,
  timeZone?: string | null
): boolean {
  if (typeof session.isBackdated === 'boolean') {
    return session.isBackdated;
  }
  if (!session.issueDate || !isValidCalendarDateKey(session.issueDate) || !session.createdAt) {
    return false;
  }
  const tz = resolveSafeTimeZone(timeZone || session.timezone);
  const createdLocalDateKey = getLocalDateKey(session.createdAt, tz);
  return session.issueDate < createdLocalDateKey;
}

/**
 * Computes the reporting date range for Today, Yesterday, Last 7 Days (including today), or Custom Date(s)
 * in the restaurant's local timezone.
 */
export function getIssueDateRange(
  preset: IssueDateFilterPreset,
  timeZone?: string | null,
  customStartDate?: string,
  customEndDate?: string,
  referenceDate: Date = new Date()
): IssueDateRange {
  const tz = resolveSafeTimeZone(timeZone);
  const todayKey = getLocalDateKey(referenceDate, tz);

  if (preset === 'TODAY') {
    return {
      preset,
      startDateKey: todayKey,
      endDateKey: todayKey,
      label: `Today (${formatDateKeyReadable(todayKey)})`,
    };
  }

  if (preset === 'YESTERDAY') {
    const yesterdayKey = shiftDateKey(todayKey, -1);
    return {
      preset,
      startDateKey: yesterdayKey,
      endDateKey: yesterdayKey,
      label: `Yesterday (${formatDateKeyReadable(yesterdayKey)})`,
    };
  }

  if (preset === 'LAST_7_DAYS') {
    const startKey = shiftDateKey(todayKey, -6); // 7 calendar days including today
    return {
      preset,
      startDateKey: startKey,
      endDateKey: todayKey,
      label: `Last 7 Days (${formatDateKeyReadable(startKey)} – ${formatDateKeyReadable(todayKey)})`,
    };
  }

  // CUSTOM
  const rawStart = (customStartDate || '').trim() || todayKey;
  const rawEnd = (customEndDate || '').trim() || rawStart;
  const startDateKey = rawStart <= rawEnd ? rawStart : rawEnd;
  const endDateKey = rawStart <= rawEnd ? rawEnd : rawStart;
  const label =
    startDateKey === endDateKey
      ? `Custom Date (${formatDateKeyReadable(startDateKey)})`
      : `${formatDateKeyReadable(startDateKey)} – ${formatDateKeyReadable(endDateKey)}`;

  return {
    preset: 'CUSTOM',
    startDateKey,
    endDateKey,
    label,
  };
}

/**
 * Filters issue sessions strictly by their local issue session date (NEVER by PDF generation date).
 */
export function filterIssueSessionsByDateRange(
  sessions: IssueSession[],
  range: Pick<IssueDateRange, 'startDateKey' | 'endDateKey'>,
  timeZone?: string | null
): IssueSession[] {
  const tz = resolveSafeTimeZone(timeZone);
  return sessions.filter((session) => {
    const sessionDateKey =
      session.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(session.issueDate)
        ? session.issueDate
        : getLocalDateKey(session.createdAt, tz);
    return sessionDateKey >= range.startDateKey && sessionDateKey <= range.endDateKey;
  });
}

/**
 * Case-insensitive, deduplicated, partial-match search for active inventory items.
 * Never mutates item names, stock quantities, or UOM values.
 */
export function searchInventoryItemsForIssue(items: Item[], rawQuery: string): Item[] {
  const query = rawQuery.trim().toLowerCase();
  const seenIds = new Set<string>();
  const activeUnique: Item[] = [];

  for (const item of items) {
    if (!item || !item.id) continue;
    if (item.status === 'inactive') continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    activeUnique.push(item);
  }

  const matched = query
    ? activeUnique.filter((item) => (item.name || '').toLowerCase().includes(query))
    : activeUnique;

  return matched.sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    if (query) {
      const aStarts = nameA.startsWith(query) ? 0 : 1;
      const bStarts = nameB.startsWith(query) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
    }
    return nameA.localeCompare(nameB);
  });
}

/**
 * Formats an inventory item search result label: e.g. "TADKA MIRCH — Available: 11 KG"
 */
export function formatSearchItemOptionLabel(item: Pick<Item, 'name' | 'currentStock' | 'unit'>): string {
  return `${item.name} — Available: ${formatQty(item.currentStock || 0)} ${item.unit}`;
}

/**
 * Validates adding or updating an item line in the multi-item issue session cart.
 */
export function validateIssueLineQuantity(
  item: Pick<Item, 'name' | 'currentStock' | 'unit'>,
  quantity: number
): { valid: boolean; error: string | null } {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { valid: false, error: `Quantity for ${item.name} must be greater than 0.` };
  }
  const available = roundQty(item.currentStock || 0);
  const requested = roundQty(quantity);
  if (requested > available) {
    return {
      valid: false,
      error: `Insufficient stock for ${item.name}. Available: ${formatQty(available)} ${item.unit}, requested: ${formatQty(requested)} ${item.unit}.`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Builds a single DraftIssueCartItem from an Inventory Item and quantity using existing WAC logic.
 */
export function buildDraftIssueCartItem(item: Item, quantity: number): DraftIssueCartItem {
  const qty = roundQty(quantity);
  const rate = getEffectiveItemWacRate(item);
  const value = Number((qty * rate).toFixed(2));
  return {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    quantity: qty,
    availableStock: roundQty(item.currentStock || 0),
    rate,
    value,
  };
}

/**
 * Computes combined totals for a list of draft session lines.
 */
export function computeDraftSessionTotals(lines: DraftIssueCartItem[]): {
  totalItems: number;
  totalValue: number;
} {
  const totalValue = Number(
    lines.reduce((sum, line) => sum + (Number(line.value) || 0), 0).toFixed(2)
  );
  return {
    totalItems: lines.length,
    totalValue,
  };
}

/**
 * Merges modern `issueSessions` with backward-compatible pre-existing legacy `issues` documents
 * (that predate session grouping) without merging separate sessions or inventing fake signatures.
 */
export function combineIssueSessionsWithLegacyRecords(
  sessions: IssueSession[],
  legacyIssues: Issue[],
  timeZone?: string | null
): IssueSession[] {
  const tz = resolveSafeTimeZone(timeZone);
  const knownSessionIds = new Set(sessions.map((s) => s.id));

  const adaptedLegacy: IssueSession[] = legacyIssues
    .filter((iss) => !iss.sessionId || !knownSessionIds.has(iss.sessionId))
    .map((iss) => {
      const resolvedIssueDate =
        iss.issueDate && isValidCalendarDateKey(iss.issueDate)
          ? iss.issueDate
          : getLocalDateKey(iss.createdAt, tz);
      return {
        id: `legacy_${iss.id}`,
        issueNumber: iss.issueNumber || `LEGACY-${iss.id.slice(-5).toUpperCase()}`,
        issueDate: resolvedIssueDate,
        issueTime: getLocalTimeString(iss.createdAt, tz),
        timezone: tz,
        isBackdated:
          typeof iss.isBackdated === 'boolean'
            ? iss.isBackdated
            : resolvedIssueDate < getLocalDateKey(iss.createdAt, tz),
        restaurantId: iss.restaurantId,
        departmentId: iss.departmentId,
        departmentName: iss.departmentName || 'Kitchen',
        shift: iss.shift || 'GENERAL',
        issuedByUid: iss.issuedByUid,
        issuedByName: iss.issuedByName || 'Storekeeper',
        receivedByUid: null,
        receivedByName: iss.staffName || 'Staff',
        items: [
          {
            itemId: iss.itemId,
            itemName: iss.itemName,
            quantity: Number(iss.quantity) || 0,
            unit: iss.unit || 'Unit',
            rate: Number(iss.rate) || 0,
            value: Number(iss.value) || 0,
            issueRecordId: iss.id,
          },
        ],
        totalItems: 1,
        totalValue: Number(iss.value) || 0,
        managerSignature: { status: 'PENDING' },
        receiverSignature: { status: 'PENDING' },
        isLegacy: true,
        createdAt: iss.createdAt,
      };
    });

  return [...sessions, ...adaptedLegacy].sort((a, b) => {
    const dateA = a.issueDate || getLocalDateKey(a.createdAt, tz);
    const dateB = b.issueDate || getLocalDateKey(b.createdAt, tz);
    const dateCmp = dateB.localeCompare(dateA);
    if (dateCmp !== 0) return dateCmp;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

/**
 * Aggregates department-wise issue summary for a filtered list of sessions.
 */
export function buildDepartmentIssueSummary(
  sessions: IssueSession[]
): DepartmentIssueSummaryRow[] {
  const map = new Map<string, DepartmentIssueSummaryRow>();
  for (const session of sessions) {
    const key = session.departmentId || session.departmentName || 'Kitchen';
    const existing = map.get(key);
    const itemCount = session.items?.length || session.totalItems || 0;
    const val = Number(session.totalValue) || 0;
    if (existing) {
      existing.sessionCount += 1;
      existing.itemCount += itemCount;
      existing.totalValue = Number((existing.totalValue + val).toFixed(2));
    } else {
      map.set(key, {
        departmentId: session.departmentId || key,
        departmentName: session.departmentName || 'Kitchen',
        sessionCount: 1,
        itemCount,
        totalValue: Number(val.toFixed(2)),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
}

/**
 * Aggregates shift-wise issue summary for a filtered list of sessions.
 */
export function buildShiftIssueSummary(sessions: IssueSession[]): ShiftIssueSummaryRow[] {
  const shiftOrder: Issue['shift'][] = ['MORNING', 'EVENING', 'NIGHT', 'GENERAL'];
  const map = new Map<Issue['shift'], ShiftIssueSummaryRow>();

  for (const session of sessions) {
    const key: Issue['shift'] = session.shift || 'GENERAL';
    const existing = map.get(key);
    const itemCount = session.items?.length || session.totalItems || 0;
    const val = Number(session.totalValue) || 0;
    if (existing) {
      existing.sessionCount += 1;
      existing.itemCount += itemCount;
      existing.totalValue = Number((existing.totalValue + val).toFixed(2));
    } else {
      map.set(key, {
        shift: key,
        shiftLabel: formatShiftLabel(key),
        sessionCount: 1,
        itemCount,
        totalValue: Number(val.toFixed(2)),
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => shiftOrder.indexOf(a.shift) - shiftOrder.indexOf(b.shift)
  );
}

/**
 * Formats a sequential Issue Number (e.g. 1 -> "ISS-001", 42 -> "ISS-042", 1024 -> "ISS-1024").
 */
export function formatIssueNumber(sequence: number): string {
  const safeSeq = Math.max(1, Math.floor(sequence));
  return `ISS-${String(safeSeq).padStart(3, '0')}`;
}

/**
 * Role & separation-of-approval check for capturing Manager Signature.
 * Only OWNER or MANAGER can sign as Manager, and never if they already signed as Receiver on this session.
 */
export function canUserSignManagerSignature(
  session: IssueSession,
  userUid: string | null | undefined,
  activeRole: UserRole | null | undefined
): boolean {
  if (!userUid || !activeRole) return false;
  if (session.isLegacy) return false;
  if (session.managerSignature?.status === 'SIGNED') return false;
  if (activeRole !== 'OWNER' && activeRole !== 'MANAGER') return false;
  if (session.receiverSignature?.signerUid === userUid) return false;
  return true;
}

/**
 * Role & separation-of-approval check for capturing Chef / Staff Receiving Signature.
 * Enforces that one user cannot sign both approvals, and unauthorized users cannot sign on behalf of someone else.
 */
export function canUserSignReceiverSignature(
  session: IssueSession,
  userUid: string | null | undefined,
  activeRole: UserRole | null | undefined
): boolean {
  if (!userUid || !activeRole) return false;
  if (session.isLegacy) return false;
  if (session.receiverSignature?.status === 'SIGNED') return false;
  if (session.managerSignature?.signerUid === userUid) return false;

  const assignedReceiverUid = (session.receivedByUid || '').trim();
  if (assignedReceiverUid) {
    return assignedReceiverUid === userUid;
  }

  // If receiver was entered by name without a specific UID binding, only DEPARTMENT_STAFF may sign as Chef/Staff receiver
  return activeRole === 'DEPARTMENT_STAFF';
}
