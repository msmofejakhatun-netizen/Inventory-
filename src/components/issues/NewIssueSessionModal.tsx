import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  CloudOff,
  FilePlus2,
  History,
  Loader2,
  PenTool,
  Plus,
  RotateCcw,
  ShoppingBasket,
  Trash2,
  X,
} from 'lucide-react';
import { Department, Issue, Item, RestaurantUser, UserRole } from '../../types';
import { SearchableItemSelector } from './SearchableItemSelector';
import { SignatureCanvas } from './SignaturePadModal';
import {
  executeMultiItemIssueSessionTransaction,
  MultiItemIssueSessionResult,
} from '../../services/restaurantService';
import {
  DraftSaveStatus,
  IssueSessionDraft,
  buildDraftDocId,
  clearIssueDraft,
  flushIssueDraftSync,
  generateDraftSessionId,
  isDraftMeaningful,
  loadBestIssueDraft,
  markIssueWorkspaceOpen,
  sanitizeIssueSessionDraft,
  saveIssueDraft,
} from '../../services/issueDraftService';
import {
  DraftIssueCartItem,
  MAX_ITEMS_PER_ISSUE_SESSION,
  buildDraftIssueCartItem,
  computeDraftSessionTotals,
  formatDateKeyReadable,
  formatQty,
  getEffectiveItemWacRate,
  getLocalDateKey,
  roundQty,
  validateIssueLineQuantity,
  validateSelectedIssueDate,
} from '../../utils/issueManagement';

interface NewIssueSessionModalProps {
  isOpen: boolean;
  restaurantId: string | null;
  timezone?: string;
  currencySymbol: string;
  items: Item[];
  itemsLoading: boolean;
  departments: Department[];
  staffMembers: RestaurantUser[];
  actorUid: string;
  actorName: string;
  actorRole: UserRole | null;
  initialDraft?: IssueSessionDraft | null;
  onDraftUpdated?: (draft: IssueSessionDraft | null) => void;
  onClose: () => void;
  onSuccess: (result: MultiItemIssueSessionResult) => void;
}

function extractReadableError(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to confirm stock issue session.';
  const raw = err.message || '';
  if (raw.startsWith('{') && raw.includes('"error"')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        const msg = String(parsed.error);
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
          return 'You do not have permission to issue stock for this restaurant.';
        }
        return msg;
      }
    } catch {
      // ignore
    }
  }
  return raw || 'Failed to confirm stock issue session.';
}

export const NewIssueSessionModal: React.FC<NewIssueSessionModalProps> = ({
  isOpen,
  restaurantId,
  timezone,
  currencySymbol,
  items,
  itemsLoading,
  departments,
  staffMembers,
  actorUid,
  actorName,
  actorRole,
  initialDraft,
  onDraftUpdated,
  onClose,
  onSuccess,
}) => {
  // Stable session draft ID used for idempotent final stock confirmation
  const [draftSessionId, setDraftSessionId] = useState<string>(() => generateDraftSessionId());

  // Session header fields
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [shift, setShift] = useState<Issue['shift']>('MORNING');
  const [issueDate, setIssueDate] = useState<string>(() => getLocalDateKey(new Date(), timezone));
  const [selectedReceiverUid, setSelectedReceiverUid] = useState<string>('');
  const [receivedByName, setReceivedByName] = useState('');

  // Item Adder Controls (controlled searchQuery so search state persists in draft)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantityInput, setQuantityInput] = useState<string>('1');
  const [cartItems, setCartItems] = useState<DraftIssueCartItem[]>([]);

  // Duplicate item notice when user picks an item already in the session
  const [duplicateItemNotice, setDuplicateItemNotice] = useState<{
    item: Item;
    existingQty: number;
    requestedQty: number;
  } | null>(null);

  // Optional pre-confirmation Manager Signature (ONLY for OWNER or MANAGER)
  const canPreSignAsManager = actorRole === 'OWNER' || actorRole === 'MANAGER';
  const [includeManagerSignature, setIncludeManagerSignature] = useState(false);
  const [managerSignatureDataUrl, setManagerSignatureDataUrl] = useState<string | null>(null);
  const [signatureCanvasKey, setSignatureCanvasKey] = useState(0);

  // Draft auto-save & recovery state
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoredBannerVisible, setRestoredBannerVisible] = useState(false);
  const [confirmResetMode, setConfirmResetMode] = useState<'clear' | 'new' | null>(null);
  const [hydrating, setHydrating] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Refs to prevent race conditions, destructive resets, or post-confirm re-saves
  const submitLockRef = useRef(false);
  const hydratedKeyRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);
  const confirmedSessionIdRef = useRef<string | null>(null);
  const latestDraftPayloadRef = useRef<IssueSessionDraft | null>(null);
  const hasUserInteractedRef = useRef(false);
  const initialDraftRef = useRef(initialDraft);
  initialDraftRef.current = initialDraft;
  const departmentsRef = useRef(departments);
  departmentsRef.current = departments;
  const staffMembersRef = useRef(staffMembers);
  staffMembersRef.current = staffMembers;
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;

  const clearPendingSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const applyFreshDefaults = useCallback(
    (preserveBanner = false) => {
      const freshId = generateDraftSessionId();
      const todayKey = getLocalDateKey(new Date(), timezoneRef.current);
      const depts = departmentsRef.current;
      const staff = staffMembersRef.current;

      setDraftSessionId(freshId);
      setSelectedDeptId(depts[0]?.id || '');
      setShift('MORNING');
      setIssueDate(todayKey);

      const kitchenStaff = staff.find(
        (s) => s.role === 'DEPARTMENT_STAFF' && s.uid !== actorUid && s.status !== 'inactive' && s.status !== 'INACTIVE'
      );
      if (kitchenStaff) {
        setSelectedReceiverUid(kitchenStaff.uid);
        setReceivedByName(kitchenStaff.name);
      } else {
        setSelectedReceiverUid('');
        setReceivedByName('');
      }

      setSearchQuery('');
      setSelectedItemId('');
      setQuantityInput('1');
      setCartItems([]);
      setDuplicateItemNotice(null);
      setIncludeManagerSignature(false);
      setManagerSignatureDataUrl(null);
      setSignatureCanvasKey((k) => k + 1);
      setFormError(null);
      setConfirmResetMode(null);
      setSaveStatus('idle');
      setLastSavedAt(null);
      if (!preserveBanner) setRestoredBannerVisible(false);
      hasUserInteractedRef.current = false;
      latestDraftPayloadRef.current = null;
    },
    [actorUid]
  );

  const applyRestoredDraft = useCallback((draft: IssueSessionDraft) => {
    const depts = departmentsRef.current;
    const validDept =
      draft.departmentId && (depts.length === 0 || depts.some((d) => d.id === draft.departmentId))
        ? draft.departmentId
        : depts[0]?.id || draft.departmentId || '';

    const todayKey = getLocalDateKey(new Date(), timezoneRef.current);
    const restoredDateCheck = validateSelectedIssueDate(draft.issueDate, timezoneRef.current);
    const safeIssueDate = restoredDateCheck.valid ? restoredDateCheck.normalizedDateKey : todayKey;

    setDraftSessionId(draft.draftSessionId || generateDraftSessionId());
    setSelectedDeptId(validDept);
    setShift(draft.shift || 'MORNING');
    setIssueDate(safeIssueDate);
    setSelectedReceiverUid(draft.selectedReceiverUid || '');
    setReceivedByName(draft.receivedByName || '');
    setSearchQuery(draft.searchQuery || '');
    setSelectedItemId(draft.selectedItemId || '');
    setQuantityInput(draft.quantityInput || '1');
    setCartItems(Array.isArray(draft.cartItems) ? draft.cartItems : []);
    setDuplicateItemNotice(null);
    setIncludeManagerSignature(Boolean(draft.includeManagerSignature));
    setManagerSignatureDataUrl(draft.managerSignatureDataUrl || null);
    setSignatureCanvasKey((k) => k + 1);
    setFormError(null);
    setConfirmResetMode(null);
    setSaveStatus('saved');
    setLastSavedAt(draft.updatedAt || Date.now());
    setRestoredBannerVisible(true);
    hasUserInteractedRef.current = true;
    latestDraftPayloadRef.current = draft;
  }, []);

  // Lock body scroll while full-screen workspace is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Hydrate ONCE per open cycle for (restaurantId, actorUid) — NEVER resets on re-renders/timezone updates
  useEffect(() => {
    if (!isOpen) {
      hydratedKeyRef.current = null;
      clearPendingSaveTimer();
      return;
    }
    if (!restaurantId || !actorUid) return;

    const sessionKey = `${restaurantId}::${actorUid}`;
    if (hydratedKeyRef.current === sessionKey) {
      return;
    }

    hydratedKeyRef.current = sessionKey;
    markIssueWorkspaceOpen(restaurantId, actorUid, true);
    let cancelled = false;
    isHydratingRef.current = true;
    setHydrating(true);
    submitLockRef.current = false;
    setSubmitting(false);

    const hydrate = async () => {
      try {
        const preloaded = initialDraftRef.current;
        const todayKey = getLocalDateKey(new Date(), timezoneRef.current);
        const defaultDeptId = departmentsRef.current[0]?.id || '';

        // Apply preloaded draft immediately for zero flicker if scoped cleanly
        if (
          preloaded &&
          preloaded.restaurantId === restaurantId &&
          preloaded.actorUid === actorUid &&
          preloaded.draftSessionId !== confirmedSessionIdRef.current &&
          isDraftMeaningful(preloaded, todayKey, defaultDeptId)
        ) {
          applyRestoredDraft(preloaded);
        }

        const freshest = await loadBestIssueDraft(restaurantId, actorUid);
        if (cancelled) return;

        if (
          freshest &&
          freshest.draftSessionId !== confirmedSessionIdRef.current &&
          isDraftMeaningful(freshest, todayKey, defaultDeptId)
        ) {
          if (!preloaded || freshest.updatedAt >= preloaded.updatedAt) {
            applyRestoredDraft(freshest);
            onDraftUpdated?.(freshest);
          }
        } else if (!preloaded) {
          applyFreshDefaults(false);
        }
      } catch (err) {
        console.warn('[NewIssueSessionModal] Draft hydration failed, starting fresh:', err);
        if (!cancelled) {
          applyFreshDefaults(false);
        }
      } finally {
        if (!cancelled) {
          isHydratingRef.current = false;
          setHydrating(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [isOpen, restaurantId, actorUid, applyFreshDefaults, applyRestoredDraft, clearPendingSaveTimer, onDraftUpdated]);

  // If departments finish loading AFTER open and selectedDeptId is still empty, set ONLY selectedDeptId
  useEffect(() => {
    if (!isOpen || isHydratingRef.current) return;
    if (!selectedDeptId && departments.length > 0) {
      setSelectedDeptId(departments[0].id);
    }
  }, [isOpen, departments, selectedDeptId]);

  // Live Issue Date validation against restaurant local timezone (blocks future dates, detects backdated entries)
  const issueDateValidation = useMemo(
    () => validateSelectedIssueDate(issueDate, timezone),
    [issueDate, timezone]
  );
  const todayDateKey = issueDateValidation.todayDateKey;
  const isBackdatedEntry = issueDateValidation.valid && issueDateValidation.isBackdated;

  // Keep live available stock & WAC synced for items in the cart
  const liveCartItems = useMemo(() => {
    return cartItems.map((line) => {
      const live = items.find((i) => i.id === line.itemId);
      if (!live) return line;
      const rate = getEffectiveItemWacRate(live);
      return {
        ...line,
        itemName: live.name,
        unit: live.unit,
        availableStock: roundQty(live.currentStock || 0),
        rate,
        value: Number((line.quantity * rate).toFixed(2)),
      };
    });
  }, [cartItems, items]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  const addedItemIds = useMemo(
    () => new Set(cartItems.map((c) => c.itemId)),
    [cartItems]
  );

  const { totalItems, totalValue } = useMemo(
    () => computeDraftSessionTotals(liveCartItems),
    [liveCartItems]
  );

  const hasOverStockLine = useMemo(
    () => liveCartItems.some((line) => line.quantity > line.availableStock || line.quantity <= 0),
    [liveCartItems]
  );

  // Build current sanitized draft snapshot (NEVER deducts stock)
  const currentDraftSnapshot = useMemo<IssueSessionDraft | null>(() => {
    if (!restaurantId || !actorUid) return null;
    return sanitizeIssueSessionDraft({
      draftId: buildDraftDocId(actorUid),
      draftSessionId,
      restaurantId,
      actorUid,
      status: 'DRAFT',
      departmentId: selectedDeptId,
      shift,
      issueDate,
      selectedReceiverUid,
      receivedByName,
      searchQuery,
      selectedItemId,
      quantityInput,
      cartItems: liveCartItems,
      includeManagerSignature: canPreSignAsManager ? includeManagerSignature : false,
      managerSignatureDataUrl:
        canPreSignAsManager && includeManagerSignature ? managerSignatureDataUrl : null,
      updatedAt: Date.now(),
    });
  }, [
    restaurantId,
    actorUid,
    draftSessionId,
    selectedDeptId,
    shift,
    issueDate,
    selectedReceiverUid,
    receivedByName,
    searchQuery,
    selectedItemId,
    quantityInput,
    liveCartItems,
    canPreSignAsManager,
    includeManagerSignature,
    managerSignatureDataUrl,
  ]);

  // Keep latest ref in sync for emergency visibilitychange/pagehide flush
  useEffect(() => {
    if (!isOpen || isHydratingRef.current) return;
    if (confirmedSessionIdRef.current === draftSessionId) return;
    latestDraftPayloadRef.current = currentDraftSnapshot;
  }, [isOpen, currentDraftSnapshot, draftSessionId]);

  const persistDraftNow = useCallback(
    async (draftToSave: IssueSessionDraft | null) => {
      if (!draftToSave) return;
      if (confirmedSessionIdRef.current === draftToSave.draftSessionId) return;
      if (submitLockRef.current) return;

      const seq = ++saveSeqRef.current;
      setSaveStatus('saving');

      const stampedDraft: IssueSessionDraft = {
        ...draftToSave,
        updatedAt: Date.now(),
        updatedAtIso: new Date().toISOString(),
      };

      const res = await saveIssueDraft(stampedDraft);
      if (seq !== saveSeqRef.current) return;
      if (confirmedSessionIdRef.current === draftToSave.draftSessionId) return;

      if (res.ok) {
        setSaveStatus('saved');
        setLastSavedAt(stampedDraft.updatedAt);
        onDraftUpdated?.(stampedDraft);
      } else {
        setSaveStatus('error');
      }
    },
    [onDraftUpdated]
  );

  // Schedule auto-save with short debounce (immediate 100ms for discrete actions, 450ms for typing)
  const scheduleDraftSave = useCallback(
    (delayMs: number) => {
      if (!isOpen || isHydratingRef.current || submitLockRef.current) return;
      if (!currentDraftSnapshot) return;
      if (confirmedSessionIdRef.current === currentDraftSnapshot.draftSessionId) return;

      hasUserInteractedRef.current = true;
      clearPendingSaveTimer();
      setSaveStatus('saving');
      const snapshot = currentDraftSnapshot;

      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void persistDraftNow(snapshot);
      }, delayMs);
    },
    [isOpen, currentDraftSnapshot, clearPendingSaveTimer, persistDraftNow]
  );

  // Trigger immediate auto-save on discrete session/item/signature changes
  const discreteSignature = useMemo(
    () =>
      JSON.stringify({
        draftSessionId,
        selectedDeptId,
        shift,
        issueDate,
        selectedReceiverUid,
        selectedItemId,
        cartCount: cartItems.length,
        cartIds: cartItems.map((c) => c.itemId).join(','),
        includeManagerSignature,
        sigLen: managerSignatureDataUrl?.length || 0,
      }),
    [
      draftSessionId,
      selectedDeptId,
      shift,
      issueDate,
      selectedReceiverUid,
      selectedItemId,
      cartItems,
      includeManagerSignature,
      managerSignatureDataUrl,
    ]
  );

  const prevDiscreteRef = useRef<string>('');
  useEffect(() => {
    if (!isOpen || isHydratingRef.current || !currentDraftSnapshot) {
      prevDiscreteRef.current = discreteSignature;
      return;
    }
    if (prevDiscreteRef.current === discreteSignature) return;
    prevDiscreteRef.current = discreteSignature;

    const defaultDeptId = departmentsRef.current[0]?.id || '';
    if (
      hasUserInteractedRef.current ||
      isDraftMeaningful(currentDraftSnapshot, todayDateKey, defaultDeptId)
    ) {
      scheduleDraftSave(100);
    }
  }, [isOpen, discreteSignature, currentDraftSnapshot, todayDateKey, scheduleDraftSave]);

  // Trigger debounced auto-save (450ms) on typing / quantity edits
  const typingSignature = useMemo(
    () =>
      JSON.stringify({
        receivedByName,
        searchQuery,
        quantityInput,
        cartQuantities: cartItems.map((c) => `${c.itemId}:${c.quantity}`).join('|'),
      }),
    [receivedByName, searchQuery, quantityInput, cartItems]
  );

  const prevTypingRef = useRef<string>('');
  useEffect(() => {
    if (!isOpen || isHydratingRef.current || !currentDraftSnapshot) {
      prevTypingRef.current = typingSignature;
      return;
    }
    if (prevTypingRef.current === typingSignature) return;
    prevTypingRef.current = typingSignature;

    const defaultDeptId = departmentsRef.current[0]?.id || '';
    if (
      hasUserInteractedRef.current ||
      isDraftMeaningful(currentDraftSnapshot, todayDateKey, defaultDeptId)
    ) {
      scheduleDraftSave(450);
    }
  }, [isOpen, typingSignature, currentDraftSnapshot, todayDateKey, scheduleDraftSave]);

  // Emergency synchronous flush on browser refresh, tab switch, or mobile app backgrounding
  useEffect(() => {
    if (!isOpen) return;

    const emergencyFlush = () => {
      const payload = latestDraftPayloadRef.current;
      if (!payload) return;
      if (confirmedSessionIdRef.current === payload.draftSessionId) return;
      const defaultDeptId = departmentsRef.current[0]?.id || '';
      if (!isDraftMeaningful(payload, getLocalDateKey(new Date(), timezoneRef.current), defaultDeptId)) {
        return;
      }
      flushIssueDraftSync({
        ...payload,
        updatedAt: Date.now(),
        updatedAtIso: new Date().toISOString(),
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        emergencyFlush();
      }
    };

    window.addEventListener('pagehide', emergencyFlush);
    window.addEventListener('beforeunload', emergencyFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', emergencyFlush);
      window.removeEventListener('beforeunload', emergencyFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen]);

  const hasMeaningfulDraftProgress = useMemo(() => {
    const defaultDeptId = departments[0]?.id || '';
    return isDraftMeaningful(currentDraftSnapshot, todayDateKey, defaultDeptId);
  }, [currentDraftSnapshot, todayDateKey, departments]);

  // Add item to pending list — NEVER resets department, shift, date, receiver, cart, or signature
  const handleAddItemToSession = () => {
    setFormError(null);
    setDuplicateItemNotice(null);
    hasUserInteractedRef.current = true;

    if (!selectedItem) {
      setFormError('Please search and select an inventory item first.');
      return;
    }

    const parsedQty = Number(quantityInput);
    const check = validateIssueLineQuantity(selectedItem, parsedQty);
    if (!check.valid) {
      setFormError(check.error);
      return;
    }

    // Prevent duplicate rows within the same issue session
    const existingLine = cartItems.find((line) => line.itemId === selectedItem.id);
    if (existingLine) {
      setDuplicateItemNotice({
        item: selectedItem,
        existingQty: existingLine.quantity,
        requestedQty: roundQty(parsedQty),
      });
      return;
    }

    if (cartItems.length >= MAX_ITEMS_PER_ISSUE_SESSION) {
      setFormError(`You can add up to ${MAX_ITEMS_PER_ISSUE_SESSION} items per issue session.`);
      return;
    }

    const newLine = buildDraftIssueCartItem(selectedItem, parsedQty);
    setCartItems((prev) => [...prev, newLine]);
    // Reset ONLY temporary item adder controls
    setSearchQuery('');
    setSelectedItemId('');
    setQuantityInput('1');
  };

  const handleUpdateExistingDuplicateRow = (mode: 'replace' | 'add') => {
    if (!duplicateItemNotice) return;
    hasUserInteractedRef.current = true;
    const { item, existingQty, requestedQty } = duplicateItemNotice;
    const targetQty = mode === 'add' ? roundQty(existingQty + requestedQty) : requestedQty;
    const check = validateIssueLineQuantity(item, targetQty);
    if (!check.valid) {
      setFormError(check.error);
      return;
    }
    const updatedLine = buildDraftIssueCartItem(item, targetQty);
    setCartItems((prev) => prev.map((line) => (line.itemId === item.id ? updatedLine : line)));
    setDuplicateItemNotice(null);
    setSearchQuery('');
    setSelectedItemId('');
    setQuantityInput('1');
    setFormError(null);
  };

  const handleEditCartItemQuantity = (itemId: string, rawVal: string) => {
    hasUserInteractedRef.current = true;
    const parsed = Number(rawVal);
    if (rawVal === '') {
      setCartItems((prev) =>
        prev.map((line) => (line.itemId === itemId ? { ...line, quantity: 0, value: 0 } : line))
      );
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const rounded = roundQty(parsed);
    setCartItems((prev) =>
      prev.map((line) =>
        line.itemId === itemId
          ? { ...line, quantity: rounded, value: Number((rounded * line.rate).toFixed(2)) }
          : line
      )
    );
    if (formError) setFormError(null);
  };

  const handleRemoveCartItem = (itemId: string) => {
    hasUserInteractedRef.current = true;
    setCartItems((prev) => prev.filter((line) => line.itemId !== itemId));
    if (duplicateItemNotice?.item.id === itemId) {
      setDuplicateItemNotice(null);
    }
  };

  // Explicit Draft Clear / Start New Session handler (never loses work silently)
  const handleRequestReset = (mode: 'clear' | 'new') => {
    if (submitting) return;
    if (!hasMeaningfulDraftProgress) {
      void executeResetDraft();
      return;
    }
    setConfirmResetMode(mode);
  };

  const executeResetDraft = async () => {
    clearPendingSaveTimer();
    saveSeqRef.current += 1;
    if (restaurantId && actorUid) {
      await clearIssueDraft(restaurantId, actorUid);
    }
    onDraftUpdated?.(null);
    applyFreshDefaults(false);
  };

  // Close workspace safely: flushes pending draft without discarding it
  const handleSafeClose = () => {
    if (submitting) return;
    clearPendingSaveTimer();
    if (
      currentDraftSnapshot &&
      confirmedSessionIdRef.current !== currentDraftSnapshot.draftSessionId &&
      hasMeaningfulDraftProgress
    ) {
      const flushed: IssueSessionDraft = {
        ...currentDraftSnapshot,
        updatedAt: Date.now(),
        updatedAtIso: new Date().toISOString(),
      };
      flushIssueDraftSync(flushed);
      void saveIssueDraft(flushed);
      onDraftUpdated?.(flushed);
    }
    markIssueWorkspaceOpen(restaurantId, actorUid, false);
    onClose();
  };

  const handleConfirmSession = async () => {
    if (submitLockRef.current || submitting) return;
    setFormError(null);

    if (!restaurantId) {
      setFormError('No active restaurant selected.');
      return;
    }
    if (!selectedDeptId) {
      setFormError('Please select a kitchen department.');
      return;
    }

    const finalDateCheck = validateSelectedIssueDate(issueDate, timezone);
    if (!finalDateCheck.valid) {
      setFormError(finalDateCheck.error || 'Please select a valid Issue Date.');
      return;
    }

    if (!receivedByName.trim()) {
      setFormError('Please enter the Chef / Staff name receiving the stock.');
      return;
    }
    if (liveCartItems.length === 0) {
      setFormError('Add at least one item to the issue session before confirming.');
      return;
    }

    for (const line of liveCartItems) {
      const liveItem = items.find((i) => i.id === line.itemId);
      if (!liveItem) {
        setFormError(`Item "${line.itemName}" is no longer available.`);
        return;
      }
      const check = validateIssueLineQuantity(liveItem, line.quantity);
      if (!check.valid) {
        setFormError(check.error);
        return;
      }
    }

    if (includeManagerSignature && !managerSignatureDataUrl) {
      setFormError('Please draw your Manager Signature or uncheck "Sign as Manager now".');
      return;
    }

    const deptObj = departments.find((d) => d.id === selectedDeptId);
    const effectiveReceiverUid =
      selectedReceiverUid && selectedReceiverUid !== actorUid ? selectedReceiverUid : null;

    // Cancel any pending auto-save timers before starting atomic stock deduction
    clearPendingSaveTimer();
    saveSeqRef.current += 1;

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await executeMultiItemIssueSessionTransaction(restaurantId, {
        draftSessionId,
        departmentId: selectedDeptId,
        departmentName: deptObj?.name || 'Kitchen',
        shift,
        issueDate: finalDateCheck.normalizedDateKey,
        issuedByUid: actorUid,
        issuedByName: actorName,
        issuedByRole: actorRole || undefined,
        receivedByUid: effectiveReceiverUid,
        receivedByName: receivedByName.trim(),
        timezone,
        items: liveCartItems.map((line) => ({
          itemId: line.itemId,
          itemName: line.itemName,
          unit: line.unit,
          quantity: line.quantity,
        })),
        managerSignatureDataUrl:
          canPreSignAsManager && includeManagerSignature ? managerSignatureDataUrl : null,
      });

      // Mark confirmed so no late event can resurrect this draft
      confirmedSessionIdRef.current = draftSessionId;
      latestDraftPayloadRef.current = null;
      await clearIssueDraft(restaurantId, actorUid);
      markIssueWorkspaceOpen(restaurantId, actorUid, false);
      onDraftUpdated?.(null);
      applyFreshDefaults(false);

      onSuccess(result);
      onClose();
    } catch (err) {
      // Confirmation failed — keep draft intact so user loses zero work
      setFormError(extractReadableError(err));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const formattedSavedTime = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div
      id="new-issue-session-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Issue Stock to Kitchen Department"
      className="fixed inset-0 z-50 w-screen h-screen h-[100dvh] flex flex-col bg-stone-100 overflow-hidden"
    >
      {/* Top Sticky Full-Screen Header (Mobile Safe-Area Aware) */}
      <header className="shrink-0 bg-[#0D2149] text-white border-b border-white/10 pt-[env(safe-area-inset-top)] shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              id="close-issue-workspace-btn"
              type="button"
              disabled={submitting}
              onClick={handleSafeClose}
              aria-label="Back to Store to Kitchen Issues"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-45"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-white truncate">
                  Issue Stock to Kitchen
                </h2>
                <span className="hidden md:inline-block px-2 py-0.5 rounded bg-[#FF5A1F]/20 text-[#FF8B5E] text-[10px] font-bold uppercase tracking-wider">
                  Full-Screen Workspace
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate">
                Auto-saves safely as draft • Stock deducts atomically only upon final confirmation
              </p>
            </div>
          </div>

          {/* Right Header Controls: Auto-save status + Clear / New Draft actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Subtle Auto-Save Status Indicator */}
            <div id="issue-draft-save-status" aria-live="polite" className="shrink-0">
              {saveStatus === 'saving' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-slate-200 text-[11px] font-semibold">
                  <Loader2 className="w-3 h-3 animate-spin text-[#FF5A1F]" />
                  <span>Saving...</span>
                </span>
              )}
              {saveStatus === 'saved' && (
                <span
                  title={formattedSavedTime ? `Last saved at ${formattedSavedTime}` : 'Draft saved'}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-400/25 text-[11px] font-semibold"
                >
                  <Check className="w-3 h-3 text-emerald-300" />
                  <span>Saved</span>
                </span>
              )}
              {saveStatus === 'error' && (
                <button
                  id="issue-draft-retry-save-btn"
                  type="button"
                  onClick={() => void persistDraftNow(currentDraftSnapshot)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 text-rose-100 border border-rose-400/40 text-[11px] font-bold transition-colors"
                >
                  <CloudOff className="w-3 h-3" />
                  <span>Save failed – Retry</span>
                </button>
              )}
            </div>

            {/* Start New Session button */}
            <button
              id="start-new-issue-session-btn"
              type="button"
              disabled={submitting}
              onClick={() => handleRequestReset('new')}
              title="Start a fresh blank Issue Stock session"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold transition-colors disabled:opacity-45"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-[#FF5A1F]" />
              <span>New Session</span>
            </button>

            {/* Clear Draft button */}
            {hasMeaningfulDraftProgress && (
              <button
                id="clear-issue-draft-btn"
                type="button"
                disabled={submitting}
                onClick={() => handleRequestReset('clear')}
                title="Clear unfinished draft"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-rose-500/30 text-slate-200 hover:text-white text-[11px] font-semibold transition-colors disabled:opacity-45"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear Draft</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable Main Full-Screen Workspace Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
          {/* Restored Draft Notification Banner */}
          {restoredBannerVisible && (
            <div
              id="issue-draft-restored-banner"
              className="p-3 sm:p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-[#0D2149] flex items-center justify-between gap-3 shadow-2xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <History className="w-4 h-4 text-[#0D2149] shrink-0" />
                <span className="font-semibold">
                  Previous unfinished Issue Stock session restored.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleRequestReset('clear')}
                  className="text-[11px] font-bold text-rose-700 hover:text-rose-800 underline underline-offset-2"
                >
                  Clear Draft
                </button>
                <button
                  type="button"
                  aria-label="Dismiss restored session notice"
                  onClick={() => setRestoredBannerVisible(false)}
                  className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-blue-100/70"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Explicit Confirmation Prompt before Clearing Draft / Starting New Session */}
          {confirmResetMode && (
            <div
              id="issue-draft-clear-confirm-banner"
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#FF5A1F] shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-[#0D2149]">
                    {confirmResetMode === 'new'
                      ? 'Start a brand-new Issue Stock session?'
                      : 'Clear this unfinished Issue Stock draft?'}
                  </p>
                  <p className="text-[11px] text-amber-900 mt-0.5">
                    This will remove your saved draft ({totalItems}{' '}
                    {totalItems === 1 ? 'pending item' : 'pending items'}) and reset the form. Inventory stock is unaffected.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmResetMode(null)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-stone-300 text-stone-700 font-semibold text-xs hover:bg-stone-50"
                >
                  Keep Draft
                </button>
                <button
                  id="confirm-clear-issue-draft-btn"
                  type="button"
                  onClick={() => void executeResetDraft()}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
                >
                  {confirmResetMode === 'new' ? 'Discard & Start New' : 'Yes, Clear Draft'}
                </button>
              </div>
            </div>
          )}

          {/* Form Error Banner */}
          {formError && (
            <div
              id="issue-session-form-error"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-start justify-between gap-2"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setFormError(null)}
                className="text-rose-400 hover:text-rose-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {hydrating && (
            <div className="p-3 rounded-xl bg-white border border-stone-200 text-xs text-stone-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#FF5A1F]" />
              <span>Checking for any unfinished Issue Stock draft...</span>
            </div>
          )}

          {/* Responsive 2-Column Workspace on Desktop/Tablet, Clean Single Column on Mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
            {/* LEFT COLUMN: Session Details + Smart Item Adder + Optional Manager Signature */}
            <div className="lg:col-span-5 space-y-4">
              {/* 1. Session Details Card */}
              <section className="p-4 sm:p-5 rounded-2xl bg-white border border-stone-200 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-extrabold text-[#0D2149] uppercase tracking-wider">
                    1. Session Details
                  </h3>
                  <span className="text-[10px] font-semibold text-stone-400">
                    Auto-saved on change
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="issue-dept-select"
                      className="block text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
                    >
                      Kitchen Department *
                    </label>
                    <select
                      id="issue-dept-select"
                      value={selectedDeptId}
                      onChange={(e) => {
                        hasUserInteractedRef.current = true;
                        setSelectedDeptId(e.target.value);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 text-base sm:text-xs font-medium border border-stone-300 rounded-xl bg-white focus:outline-none focus:border-[#0D2149]"
                    >
                      {departments.length === 0 ? (
                        <option value="">No departments found</option>
                      ) : (
                        departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="issue-shift-select"
                      className="block text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
                    >
                      Shift *
                    </label>
                    <select
                      id="issue-shift-select"
                      value={shift}
                      onChange={(e) => {
                        hasUserInteractedRef.current = true;
                        setShift(e.target.value as Issue['shift']);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 text-base sm:text-xs font-medium border border-stone-300 rounded-xl bg-white focus:outline-none focus:border-[#0D2149]"
                    >
                      <option value="MORNING">Morning Shift</option>
                      <option value="EVENING">Evening Shift</option>
                      <option value="NIGHT">Night Shift</option>
                      <option value="GENERAL">General Store</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="issue-date-input"
                      className="flex items-center justify-between gap-1 text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#FF5A1F]" />
                        <span>ISSUE DATE *</span>
                      </span>
                      {isBackdatedEntry ? (
                        <span className="px-1.5 py-0.5 rounded bg-[#FF5A1F]/15 text-[#FF5A1F] text-[10px] font-extrabold normal-case">
                          Backdated
                        </span>
                      ) : (
                        issueDate === todayDateKey && (
                          <span className="text-[10px] font-semibold text-emerald-700 normal-case">
                            Today
                          </span>
                        )
                      )}
                    </label>
                    <input
                      id="issue-date-input"
                      type="date"
                      max={todayDateKey}
                      value={issueDate}
                      onChange={(e) => {
                        hasUserInteractedRef.current = true;
                        setIssueDate(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      className={`w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 text-base sm:text-xs font-mono font-semibold border rounded-xl bg-white text-stone-900 focus:outline-none ${
                        !issueDateValidation.valid
                          ? 'border-rose-400 focus:border-rose-500'
                          : isBackdatedEntry
                          ? 'border-[#FF5A1F] focus:border-[#FF5A1F]'
                          : 'border-stone-300 focus:border-[#0D2149]'
                      }`}
                    />
                    {!issueDateValidation.valid && issueDateValidation.error && (
                      <p id="issue-date-error" className="text-[11px] font-semibold text-rose-600 mt-1">
                        {issueDateValidation.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="issue-received-by-input"
                      className="block text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
                    >
                      Received By (Chef / Staff) *
                    </label>
                    <input
                      id="issue-received-by-input"
                      type="text"
                      maxLength={100}
                      placeholder="e.g. Chef Sandip / Rahul"
                      value={receivedByName}
                      onChange={(e) => {
                        hasUserInteractedRef.current = true;
                        const val = e.target.value;
                        setReceivedByName(val);
                        const exactStaff = staffMembers.find(
                          (s) => s.name.trim().toLowerCase() === val.trim().toLowerCase()
                        );
                        setSelectedReceiverUid(exactStaff ? exactStaff.uid : '');
                      }}
                      className="w-full min-h-[44px] sm:min-h-[40px] px-3 py-2 text-base sm:text-xs font-medium border border-stone-300 rounded-xl bg-white focus:outline-none focus:border-[#0D2149]"
                    />
                  </div>
                </div>

                {staffMembers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mr-1">
                      Quick select:
                    </span>
                    {staffMembers
                      .filter(
                        (s) =>
                          s.uid !== actorUid &&
                          s.status !== 'inactive' &&
                          s.status !== 'INACTIVE'
                      )
                      .slice(0, 6)
                      .map((staff) => (
                        <button
                          key={staff.uid}
                          type="button"
                          onClick={() => {
                            hasUserInteractedRef.current = true;
                            setSelectedReceiverUid(staff.uid);
                            setReceivedByName(staff.name);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                            selectedReceiverUid === staff.uid
                              ? 'bg-[#0D2149] text-white border-[#0D2149]'
                              : 'bg-stone-50 text-stone-700 border-stone-200 hover:border-[#0D2149]/40'
                          }`}
                        >
                          {staff.name}
                        </button>
                      ))}
                  </div>
                )}

                {/* Backdated Entry Warning Banner */}
                {isBackdatedEntry && (
                  <div
                    id="backdated-issue-warning"
                    className="p-3 rounded-xl bg-amber-50 border border-[#FF5A1F]/40 text-xs text-amber-950 flex items-start gap-2.5"
                  >
                    <AlertTriangle className="w-4 h-4 text-[#FF5A1F] shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-[#0D2149]">
                        Backdated Issue Date Selected: {formatDateKeyReadable(issueDate)}
                      </p>
                      <p className="text-[11px] leading-relaxed text-amber-900">
                        You are recording a backdated stock issue. The stock will be deducted now, but the report will show the selected Issue Date.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* 2. Searchable Item Selector + Quantity + Add to Pending List */}
              <section className="p-4 sm:p-5 rounded-2xl bg-white border border-stone-200 shadow-2xs space-y-3.5">
                <h3 className="text-xs font-extrabold text-[#0D2149] uppercase tracking-wider">
                  2. Search &amp; Add Inventory Items
                </h3>

                <SearchableItemSelector
                  items={items}
                  loading={itemsLoading}
                  selectedItemId={selectedItemId}
                  searchQuery={searchQuery}
                  onSearchQueryChange={(val) => {
                    hasUserInteractedRef.current = true;
                    setSearchQuery(val);
                  }}
                  addedItemIds={addedItemIds}
                  currencySymbol={currencySymbol}
                  onSelectItem={(item) => {
                    hasUserInteractedRef.current = true;
                    setSelectedItemId(item?.id || '');
                    setDuplicateItemNotice(null);
                    setFormError(null);
                  }}
                />

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-5">
                    <label
                      htmlFor="issue-item-qty-input"
                      className="block text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
                    >
                      Issue Quantity {selectedItem ? `(${selectedItem.unit})` : ''} *
                    </label>
                    <div className="relative">
                      <input
                        id="issue-item-qty-input"
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        max={selectedItem ? selectedItem.currentStock : undefined}
                        step="any"
                        value={quantityInput}
                        onChange={(e) => {
                          hasUserInteractedRef.current = true;
                          setQuantityInput(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAddItemToSession();
                          }
                        }}
                        placeholder="Enter qty"
                        className="w-full min-h-[44px] sm:min-h-[40px] pl-3 pr-14 py-2 text-base sm:text-xs font-mono font-bold text-stone-900 border border-stone-300 rounded-xl focus:outline-none focus:border-[#FF5A1F]"
                      />
                      {selectedItem && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400">
                          {selectedItem.unit}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-7">
                    <button
                      id="add-item-to-issue-session-btn"
                      type="button"
                      onClick={handleAddItemToSession}
                      disabled={!selectedItem || Number(selectedItem.currentStock || 0) <= 0}
                      className="w-full min-h-[44px] sm:min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold shadow-xs disabled:opacity-45 transition-colors"
                    >
                      <Plus className="w-4 h-4 text-[#FF5A1F]" />
                      <span>Add Item to Issue List</span>
                    </button>
                  </div>
                </div>

                {/* Duplicate Prevention Prompt */}
                {duplicateItemNotice && (
                  <div
                    id="duplicate-issue-item-prompt"
                    className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2"
                  >
                    <p className="font-semibold">
                      <span className="font-bold">{duplicateItemNotice.item.name}</span> is already in this issue session (current row: {formatQty(duplicateItemNotice.existingQty)} {duplicateItemNotice.item.unit}). Duplicate rows are not allowed.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateExistingDuplicateRow('add')}
                        className="px-3 py-1.5 rounded-lg bg-[#0D2149] text-white font-bold text-[11px] hover:bg-[#153168]"
                      >
                        Add +{formatQty(duplicateItemNotice.requestedQty)} {duplicateItemNotice.item.unit} (Total:{' '}
                        {formatQty(duplicateItemNotice.existingQty + duplicateItemNotice.requestedQty)}{' '}
                        {duplicateItemNotice.item.unit})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateExistingDuplicateRow('replace')}
                        className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] hover:bg-amber-100"
                      >
                        Replace with {formatQty(duplicateItemNotice.requestedQty)} {duplicateItemNotice.item.unit}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicateItemNotice(null)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 hover:text-stone-900"
                      >
                        Edit row manually
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* 3. Optional Manager Digital Pre-Signature (Strictly Owner/Manager only) */}
              {canPreSignAsManager && (
                <section className="p-4 sm:p-5 rounded-2xl bg-white border border-stone-200 shadow-2xs space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={includeManagerSignature}
                      onChange={(e) => {
                        hasUserInteractedRef.current = true;
                        setIncludeManagerSignature(e.target.checked);
                        if (!e.target.checked) setManagerSignatureDataUrl(null);
                      }}
                      className="mt-0.5 w-4 h-4 rounded border-stone-300 text-[#0D2149] focus:ring-[#0D2149]"
                    />
                    <div>
                      <span className="font-bold text-[#0D2149] inline-flex items-center gap-1.5">
                        <PenTool className="w-3.5 h-3.5 text-[#FF5A1F]" />
                        <span>Capture Manager Approval Signature now (Optional)</span>
                      </span>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        Chef / Staff receiving signature remains a separate approval and will be captured independently by the authorized receiver.
                      </p>
                    </div>
                  </label>

                  {includeManagerSignature && (
                    <SignatureCanvas
                      key={signatureCanvasKey}
                      id="new-session-manager-signature-canvas"
                      height={140}
                      initialDataUrl={managerSignatureDataUrl}
                      disabled={submitting}
                      onChange={(url) => {
                        hasUserInteractedRef.current = true;
                        setManagerSignatureDataUrl(url);
                      }}
                    />
                  )}
                </section>
              )}
            </div>

            {/* RIGHT COLUMN: Spacious Pending Issue List + Live WAC Valuation */}
            <div className="lg:col-span-7 space-y-4">
              <section className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-2xs flex flex-col">
                <div className="px-4 sm:px-5 py-3.5 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShoppingBasket className="w-4 h-4 text-[#FF5A1F]" />
                    <h3 className="text-xs font-extrabold text-[#0D2149] uppercase tracking-wider">
                      Pending Issue List ({totalItems})
                    </h3>
                  </div>
                  <span className="text-[11px] font-medium text-stone-500">
                    Draft only — stock deducts after clicking Confirm
                  </span>
                </div>

                {liveCartItems.length === 0 ? (
                  <div className="p-10 sm:p-14 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-[#0D2149]/5 text-[#0D2149] mx-auto flex items-center justify-center">
                      <ShoppingBasket className="w-6 h-6 text-[#FF5A1F]" />
                    </div>
                    <p className="text-sm font-bold text-[#0D2149]">No items added to this issue yet</p>
                    <p className="text-xs text-stone-500 max-w-sm mx-auto">
                      Search any inventory item on the left, enter the quantity, and tap <strong>Add Item to Issue List</strong>. Every addition auto-saves immediately.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 lg:max-h-[calc(100dvh-280px)] lg:overflow-y-auto">
                    {liveCartItems.map((line, index) => {
                      const isInvalidQty = line.quantity <= 0 || line.quantity > line.availableStock;
                      return (
                        <div
                          key={line.itemId}
                          id={`issue-cart-row-${line.itemId}`}
                          className={`px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                            isInvalidQty ? 'bg-rose-50/70' : 'hover:bg-stone-50/60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-lg bg-[#0D2149]/10 text-[#0D2149] font-mono font-bold text-[11px] inline-flex items-center justify-center shrink-0">
                                {index + 1}
                              </span>
                              <span className="font-bold text-sm sm:text-xs text-stone-900 truncate">
                                {line.itemName}
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-500 mt-1 pl-8">
                              Available:{' '}
                              <span className="font-mono font-semibold text-stone-700">
                                {formatQty(line.availableStock)} {line.unit}
                              </span>{' '}
                              • WAC: {currencySymbol}
                              {line.rate.toFixed(2)}/{line.unit}
                            </p>
                            {isInvalidQty && (
                              <p className="text-[11px] font-semibold text-rose-600 pl-8 mt-1">
                                {line.quantity <= 0
                                  ? 'Enter a quantity greater than 0.'
                                  : `Exceeds available stock (${formatQty(line.availableStock)} ${line.unit}).`}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 pl-8 sm:pl-0">
                            <div className="flex items-center gap-1.5">
                              <input
                                id={`issue-cart-qty-${line.itemId}`}
                                type="number"
                                inputMode="decimal"
                                min={0.01}
                                max={line.availableStock}
                                step="any"
                                aria-label={`Quantity for ${line.itemName}`}
                                value={line.quantity === 0 ? '' : line.quantity}
                                onChange={(e) => handleEditCartItemQuantity(line.itemId, e.target.value)}
                                className={`w-24 sm:w-20 min-h-[38px] sm:min-h-[34px] px-2.5 py-1 text-right font-mono font-bold rounded-lg border text-sm sm:text-xs ${
                                  isInvalidQty
                                    ? 'border-rose-400 bg-white text-rose-700'
                                    : 'border-stone-300 bg-white text-stone-900'
                                }`}
                              />
                              <span className="text-[11px] font-bold text-stone-500 w-10">
                                {line.unit}
                              </span>
                            </div>

                            <div className="text-right min-w-[82px] font-mono font-bold text-sm sm:text-xs text-stone-900">
                              {currencySymbol}
                              {line.value.toFixed(2)}
                            </div>

                            <button
                              id={`issue-cart-remove-${line.itemId}`}
                              type="button"
                              aria-label={`Remove ${line.itemName}`}
                              onClick={() => handleRemoveCartItem(line.itemId)}
                              className="p-2 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Combined Total Issue Value Summary Strip */}
                <div className="px-4 sm:px-5 py-3.5 bg-[#0D2149] text-white flex items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="text-slate-300 font-semibold">Combined Issue Value (WAC)</span>
                    <span className="block text-[11px] text-slate-300 mt-0.5">
                      {totalItems} {totalItems === 1 ? 'item' : 'items'} queued for atomic stock deduction
                    </span>
                  </div>
                  <span id="issue-session-combined-total" className="text-lg font-black font-mono text-white">
                    {currencySymbol}
                    {totalValue.toFixed(2)}
                  </span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar (Mobile Safe-Area Friendly) */}
      <footer className="shrink-0 bg-white border-t border-stone-200 px-3 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(13,33,73,0.06)]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center justify-between sm:justify-start gap-3 text-[11px] text-stone-600">
            <div className="flex items-center gap-1.5 min-w-0">
              <Calendar className="w-3.5 h-3.5 text-[#FF5A1F] shrink-0" />
              <span className="truncate">
                Issue Date:{' '}
                <strong id="confirm-selected-issue-date" className="text-[#0D2149]">
                  {issueDateValidation.valid ? formatDateKeyReadable(issueDate) : 'Invalid Date'}
                </strong>
                {isBackdatedEntry && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#FF5A1F]/15 text-[#FF5A1F] text-[10px] font-bold">
                    Backdated
                  </span>
                )}
              </span>
            </div>

            <span className="sm:hidden font-mono font-extrabold text-[#0D2149] shrink-0">
              {currencySymbol}
              {totalValue.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSafeClose}
              className="px-4 min-h-[44px] sm:min-h-[40px] py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100 rounded-xl border border-stone-200 disabled:opacity-50 transition-colors"
            >
              Save &amp; Close
            </button>
            <button
              id="confirm-issue-session-btn"
              type="button"
              onClick={() => void handleConfirmSession()}
              disabled={
                submitting ||
                liveCartItems.length === 0 ||
                hasOverStockLine ||
                !issueDateValidation.valid
              }
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 min-h-[44px] sm:min-h-[40px] py-2 rounded-xl bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing Atomic Issue...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Confirm &amp; Issue {totalItems} {totalItems === 1 ? 'Item' : 'Items'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
