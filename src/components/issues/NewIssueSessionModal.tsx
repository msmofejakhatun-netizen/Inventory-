import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Loader2,
  PenTool,
  Plus,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';
import { Department, Issue, Item, RestaurantUser, UserRole } from '../../types';
import { Modal } from '../common/Modal';
import { SearchableItemSelector } from './SearchableItemSelector';
import { SignatureCanvas } from './SignaturePadModal';
import {
  executeMultiItemIssueSessionTransaction,
  MultiItemIssueSessionResult,
} from '../../services/restaurantService';
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
  onClose,
  onSuccess,
}) => {
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [shift, setShift] = useState<Issue['shift']>('MORNING');
  const [issueDate, setIssueDate] = useState<string>(() => getLocalDateKey(new Date(), timezone));
  const [selectedReceiverUid, setSelectedReceiverUid] = useState<string>('');
  const [receivedByName, setReceivedByName] = useState('');

  // Item Adder Controls
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

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  // Initialize cleanly whenever modal opens (always default Issue Date to restaurant local today)
  useEffect(() => {
    if (isOpen) {
      setSelectedDeptId(departments[0]?.id || '');
      setShift('MORNING');
      setIssueDate(getLocalDateKey(new Date(), timezone));
      const kitchenStaff = staffMembers.find((s) => s.role === 'DEPARTMENT_STAFF' && s.uid !== actorUid);
      if (kitchenStaff) {
        setSelectedReceiverUid(kitchenStaff.uid);
        setReceivedByName(kitchenStaff.name);
      } else {
        setSelectedReceiverUid('');
        setReceivedByName('');
      }
      setSelectedItemId('');
      setQuantityInput('1');
      setCartItems([]);
      setDuplicateItemNotice(null);
      setIncludeManagerSignature(false);
      setManagerSignatureDataUrl(null);
      setFormError(null);
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }, [isOpen, timezone]);

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

  const handleAddItemToSession = () => {
    setFormError(null);
    setDuplicateItemNotice(null);

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
    setSelectedItemId('');
    setQuantityInput('1');
  };

  const handleUpdateExistingDuplicateRow = (mode: 'replace' | 'add') => {
    if (!duplicateItemNotice) return;
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
    setSelectedItemId('');
    setQuantityInput('1');
    setFormError(null);
  };

  const handleEditCartItemQuantity = (itemId: string, rawVal: string) => {
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
    setCartItems((prev) => prev.filter((line) => line.itemId !== itemId));
    if (duplicateItemNotice?.item.id === itemId) {
      setDuplicateItemNotice(null);
    }
  };

  const handleConfirmSession = async (e: React.FormEvent) => {
    e.preventDefault();
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
    // Ensure manager pre-signature cannot collide with receiver UID
    const effectiveReceiverUid =
      selectedReceiverUid && selectedReceiverUid !== actorUid ? selectedReceiverUid : null;

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await executeMultiItemIssueSessionTransaction(restaurantId, {
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

      onSuccess(result);
      onClose();
    } catch (err) {
      setFormError(extractReadableError(err));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      id="new-issue-session-modal"
      isOpen={isOpen}
      onClose={() => !submitting && onClose()}
      title="Issue Stock to Kitchen Department"
      subtitle="Add multiple items in one session. Stock is deducted atomically only upon final confirmation."
      maxWidth="2xl"
    >
      <form onSubmit={handleConfirmSession} className="space-y-5">
        {formError && (
          <div
            id="issue-session-form-error"
            className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        {/* 1. Session Header: Department, Shift, Issue Date, Received By */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <label
                htmlFor="issue-dept-select"
                className="block text-[11px] font-bold text-[#0D2149] uppercase tracking-wider mb-1"
              >
                Kitchen Department *
              </label>
              <select
                id="issue-dept-select"
                required
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="w-full min-h-[40px] px-3 py-2 text-xs font-medium border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-[#0D2149]"
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
                onChange={(e) => setShift(e.target.value as Issue['shift'])}
                className="w-full min-h-[40px] px-3 py-2 text-xs font-medium border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-[#0D2149]"
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
                required
                max={todayDateKey}
                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  if (formError) setFormError(null);
                }}
                className={`w-full min-h-[40px] px-3 py-2 text-sm sm:text-xs font-mono font-semibold border rounded-lg bg-white text-stone-900 focus:outline-none ${
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
                required
                maxLength={100}
                placeholder="e.g. Chef Sandip / Rahul"
                value={receivedByName}
                onChange={(e) => {
                  const val = e.target.value;
                  setReceivedByName(val);
                  const exactStaff = staffMembers.find(
                    (s) => s.name.trim().toLowerCase() === val.trim().toLowerCase()
                  );
                  setSelectedReceiverUid(exactStaff ? exactStaff.uid : '');
                }}
                className="w-full min-h-[40px] px-3 py-2 text-xs font-medium border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-[#0D2149]"
              />
              {staffMembers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {staffMembers
                    .filter((s) => s.uid !== actorUid && s.status !== 'inactive' && s.status !== 'INACTIVE')
                    .slice(0, 4)
                    .map((staff) => (
                      <button
                        key={staff.uid}
                        type="button"
                        onClick={() => {
                          setSelectedReceiverUid(staff.uid);
                          setReceivedByName(staff.name);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                          selectedReceiverUid === staff.uid
                            ? 'bg-[#0D2149] text-white border-[#0D2149]'
                            : 'bg-white text-stone-600 border-stone-200 hover:border-[#0D2149]/40'
                        }`}
                      >
                        {staff.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

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
        </div>

        {/* 2. Searchable Item Selector + Quantity + Add to Session */}
        <div className="p-4 rounded-xl border border-stone-200 bg-white space-y-3">
          <SearchableItemSelector
            items={items}
            loading={itemsLoading}
            selectedItemId={selectedItemId}
            addedItemIds={addedItemIds}
            currencySymbol={currencySymbol}
            onSelectItem={(item) => {
              setSelectedItemId(item?.id || '');
              setDuplicateItemNotice(null);
              setFormError(null);
            }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-6">
              <label
                htmlFor="issue-item-qty-input"
                className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider mb-1"
              >
                Issue Quantity {selectedItem ? `(${selectedItem.unit})` : ''} *
              </label>
              <div className="relative">
                <input
                  id="issue-item-qty-input"
                  type="number"
                  min={0.01}
                  max={selectedItem ? selectedItem.currentStock : undefined}
                  step="any"
                  value={quantityInput}
                  onChange={(e) => {
                    setQuantityInput(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Enter quantity"
                  className="w-full pl-3 pr-14 py-2 text-sm sm:text-xs font-mono font-bold text-stone-900 border border-stone-300 rounded-lg focus:outline-none focus:border-[#FF5A1F]"
                />
                {selectedItem && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400">
                    {selectedItem.unit}
                  </span>
                )}
              </div>
            </div>

            <div className="sm:col-span-6">
              <button
                id="add-item-to-issue-session-btn"
                type="button"
                onClick={handleAddItemToSession}
                disabled={!selectedItem || Number(selectedItem.currentStock || 0) <= 0}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold shadow-xs disabled:opacity-45 transition-colors"
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
        </div>

        {/* 3. Selected Items Preview List (Editable Quantities + Remove) */}
        <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
          <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBasket className="w-4 h-4 text-[#FF5A1F]" />
              <h4 className="text-xs font-bold text-[#0D2149] uppercase tracking-wider">
                Items in This Issue Session ({totalItems})
              </h4>
            </div>
            <span className="text-[11px] text-stone-500">
              Stock deducts only after clicking Confirm
            </span>
          </div>

          {liveCartItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-stone-400">
              No items added yet. Search and add one or more items above to build this issue session.
            </div>
          ) : (
            <div className="divide-y divide-stone-100 max-h-64 overflow-y-auto">
              {liveCartItems.map((line, index) => {
                const isInvalidQty = line.quantity <= 0 || line.quantity > line.availableStock;
                return (
                  <div
                    key={line.itemId}
                    id={`issue-cart-row-${line.itemId}`}
                    className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                      isInvalidQty ? 'bg-rose-50/70' : 'hover:bg-stone-50/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-[#0D2149]/10 text-[#0D2149] font-mono font-bold text-[10px] inline-flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <span className="font-bold text-stone-900 truncate">{line.itemName}</span>
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5 pl-7">
                        Available:{' '}
                        <span className="font-mono font-semibold text-stone-700">
                          {formatQty(line.availableStock)} {line.unit}
                        </span>{' '}
                        • WAC: {currencySymbol}
                        {line.rate.toFixed(2)}/{line.unit}
                      </p>
                      {isInvalidQty && (
                        <p className="text-[11px] font-semibold text-rose-600 pl-7 mt-0.5">
                          {line.quantity <= 0
                            ? 'Enter a quantity greater than 0.'
                            : `Exceeds available stock (${formatQty(line.availableStock)} ${line.unit}).`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-7 sm:pl-0">
                      <div className="flex items-center gap-1.5">
                        <input
                          id={`issue-cart-qty-${line.itemId}`}
                          type="number"
                          min={0.01}
                          max={line.availableStock}
                          step="any"
                          aria-label={`Quantity for ${line.itemName}`}
                          value={line.quantity === 0 ? '' : line.quantity}
                          onChange={(e) => handleEditCartItemQuantity(line.itemId, e.target.value)}
                          className={`w-20 px-2 py-1 text-right font-mono font-bold rounded-lg border text-xs ${
                            isInvalidQty
                              ? 'border-rose-400 bg-white text-rose-700'
                              : 'border-stone-300 bg-white text-stone-900'
                          }`}
                        />
                        <span className="text-[11px] font-bold text-stone-500 w-9">
                          {line.unit}
                        </span>
                      </div>

                      <div className="text-right min-w-[76px] font-mono font-bold text-stone-900">
                        {currencySymbol}
                        {line.value.toFixed(2)}
                      </div>

                      <button
                        id={`issue-cart-remove-${line.itemId}`}
                        type="button"
                        aria-label={`Remove ${line.itemName}`}
                        onClick={() => handleRemoveCartItem(line.itemId)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Combined Total Issue Value Footer */}
          <div className="px-4 py-3 bg-[#0D2149] text-white flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-300 font-medium">Combined Issue Value (WAC)</span>
              <span className="block text-[10px] text-slate-300">
                {totalItems} {totalItems === 1 ? 'item' : 'items'} queued for atomic stock deduction
              </span>
            </div>
            <span id="issue-session-combined-total" className="text-base font-black font-mono text-white">
              {currencySymbol}
              {totalValue.toFixed(2)}
            </span>
          </div>
        </div>

        {/* 4. Optional Manager Digital Pre-Signature (Strictly Owner/Manager only) */}
        {canPreSignAsManager && (
          <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/70 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={includeManagerSignature}
                onChange={(e) => {
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
                id="new-session-manager-signature-canvas"
                height={130}
                disabled={submitting}
                onChange={(url) => setManagerSignatureDataUrl(url)}
              />
            )}
          </div>
        )}

        {/* 5. Final Actions with Confirmed Issue Date Display */}
        <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-[11px] text-stone-600 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#FF5A1F] shrink-0" />
            <span>
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

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2.5 sm:py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 rounded-lg border border-stone-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="confirm-issue-session-btn"
              type="submit"
              disabled={submitting || liveCartItems.length === 0 || hasOverStockLine || !issueDateValidation.valid}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 sm:py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
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
      </form>
    </Modal>
  );
};
