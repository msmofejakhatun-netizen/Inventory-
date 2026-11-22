import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  PackageCheck,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { Item, UserRole } from '../../types';
import { Modal } from '../common/Modal';
import { executeStockAdjustmentTransaction } from '../../services/restaurantService';
import {
  STOCK_ADJUSTMENT_REASONS,
  StockAdjustmentReasonOption,
  evaluateSignificantStockDifference,
  formatSignedStockDifference,
  formatStockQuantity,
  roundStockQuantity,
  validateStockAdjustmentInput,
} from '../../utils/stockAdjustment';

export interface StockAdjustmentSuccessPayload {
  countId: string;
  itemName: string;
  unit: string;
  previousStock: number;
  newStock: number;
  difference: number;
  reason: string;
}

interface EditStockModalProps {
  isOpen: boolean;
  item: Item | null;
  restaurantId: string | null;
  actorUid: string;
  actorName: string;
  actorRole: UserRole | null;
  onClose: () => void;
  onSuccess: (result: StockAdjustmentSuccessPayload) => void;
}

function extractReadableError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Failed to save stock adjustment. Please try again.';
  }
  const raw = err.message || '';
  if (raw.startsWith('{') && raw.includes('"error"')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        const msg = String(parsed.error);
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
          return 'You do not have permission to adjust stock for this restaurant.';
        }
        return msg;
      }
    } catch {
      // fall through
    }
  }
  if (raw.toLowerCase().includes('permission') || raw.toLowerCase().includes('insufficient')) {
    return 'You do not have permission to adjust stock for this restaurant.';
  }
  return raw || 'Failed to save stock adjustment. Please try again.';
}

export const EditStockModal: React.FC<EditStockModalProps> = ({
  isOpen,
  item,
  restaurantId,
  actorUid,
  actorName,
  actorRole,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [newStockInput, setNewStockInput] = useState<string>('');
  const [reasonOption, setReasonOption] = useState<StockAdjustmentReasonOption>('Physical Stock Correction');
  const [customReason, setCustomReason] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Ref guard prevents duplicate concurrent submissions on rapid double-clicks
  const submitLockRef = useRef<boolean>(false);
  const lastOpenedItemIdRef = useRef<string | null>(null);

  // Initialize form whenever a modal opens for a new item
  useEffect(() => {
    if (isOpen && item) {
      if (lastOpenedItemIdRef.current !== item.id) {
        lastOpenedItemIdRef.current = item.id;
        setStep('edit');
        setNewStockInput(String(roundStockQuantity(item.currentStock || 0)));
        setReasonOption('Physical Stock Correction');
        setCustomReason('');
        setFormError(null);
        setSubmitting(false);
        submitLockRef.current = false;
      }
    } else if (!isOpen) {
      lastOpenedItemIdRef.current = null;
      setStep('edit');
      setFormError(null);
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }, [isOpen, item]);

  const currentStock = useMemo(
    () => roundStockQuantity(Number(item?.currentStock || 0)),
    [item?.currentStock]
  );

  const unit = item?.unit || 'Pcs';

  const parsedDraft = useMemo(() => {
    const trimmed = newStockInput.trim();
    if (trimmed === '') {
      return { hasValue: false, isValidNumber: false, value: null as number | null, diff: null as number | null };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { hasValue: true, isValidNumber: false, value: null as number | null, diff: null as number | null };
    }
    const rounded = roundStockQuantity(parsed);
    const diff = roundStockQuantity(rounded - currentStock);
    return { hasValue: true, isValidNumber: true, value: rounded, diff };
  }, [newStockInput, currentStock]);

  const significantWarning = useMemo(() => {
    if (!parsedDraft.isValidNumber || parsedDraft.value === null || parsedDraft.value < 0) {
      return { isSignificant: false, severity: null, message: null };
    }
    return evaluateSignificantStockDifference(currentStock, parsedDraft.value, unit);
  }, [currentStock, parsedDraft.isValidNumber, parsedDraft.value, unit]);

  const validationPreview = useMemo(
    () =>
      validateStockAdjustmentInput({
        currentStock,
        newStockInput,
        reasonOption,
        customReason,
      }),
    [currentStock, newStockInput, reasonOption, customReason]
  );

  const handleCloseSafely = () => {
    if (submitting || submitLockRef.current) return;
    onClose();
  };

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    const validation = validateStockAdjustmentInput({
      currentStock,
      newStockInput,
      reasonOption,
      customReason,
    });

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    setFormError(null);
    setStep('confirm');
  };

  const handleConfirmSave = async () => {
    if (!item || !restaurantId) {
      setFormError('Missing restaurant or item context. Please close and try again.');
      return;
    }
    if (submitLockRef.current || submitting) {
      return;
    }

    const validation = validateStockAdjustmentInput({
      currentStock,
      newStockInput,
      reasonOption,
      customReason,
    });

    if (!validation.valid || validation.newStock === null || validation.difference === null) {
      setFormError(validation.error || 'Invalid stock adjustment inputs.');
      setStep('edit');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      const countId = await executeStockAdjustmentTransaction(restaurantId, {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        physicalStock: validation.newStock,
        reason: validation.resolvedReason,
        countedByUid: actorUid,
        countedByName: actorName,
        actorRole: actorRole || undefined,
        requireChange: true,
      });

      onSuccess({
        countId,
        itemName: item.name,
        unit: item.unit,
        previousStock: currentStock,
        newStock: validation.newStock,
        difference: validation.difference,
        reason: validation.resolvedReason,
      });
      onClose();
    } catch (err) {
      setFormError(extractReadableError(err));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  if (!item) return null;

  const isIncrease = parsedDraft.diff !== null && parsedDraft.diff > 0;
  const isDecrease = parsedDraft.diff !== null && parsedDraft.diff < 0;

  return (
    <Modal
      id="edit-current-stock-modal"
      isOpen={isOpen}
      onClose={handleCloseSafely}
      title={step === 'confirm' ? 'Confirm Stock Adjustment' : 'Edit Current Stock'}
      subtitle={
        step === 'confirm'
          ? 'Review details before recording this permanent adjustment'
          : 'Correct current on-hand quantity with a mandatory audit trail'
      }
      maxWidth="md"
    >
      {step === 'edit' ? (
        <form onSubmit={handleProceedToConfirm} className="space-y-4">
          {/* Item Header Summary Card */}
          <div className="rounded-xl border border-slate-200 bg-[#0D2149] text-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Inventory Item
                </p>
                <h4 className="text-base font-bold text-white truncate mt-0.5">{item.name}</h4>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {item.category || 'General'} • {item.departmentName || 'General Store'}
                </p>
              </div>
              <span
                id="edit-stock-uom-badge"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 border border-white/20 text-xs font-bold text-white shrink-0"
                title="Unit of Measure cannot be changed during stock adjustment"
              >
                <Lock className="w-3 h-3 text-[#FF5A1F]" />
                <span>{unit}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-white/15">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                  Current Stock
                </span>
                <p id="edit-stock-current-value" className="text-lg font-extrabold text-white font-mono mt-0.5">
                  {formatStockQuantity(currentStock)}{' '}
                  <span className="text-xs font-semibold text-slate-300">{unit}</span>
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-300 block">
                  Unit of Measure
                </span>
                <p className="text-sm font-bold text-white mt-1">{unit}</p>
                <span className="text-[10px] text-slate-300">Locked for stock edit</span>
              </div>
            </div>
          </div>

          {/* New Stock Quantity + Automatic Difference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-stock-new-qty-input"
                className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider mb-1.5"
              >
                New Stock Quantity ({unit}) *
              </label>
              <div className="relative">
                <input
                  id="edit-stock-new-qty-input"
                  type="number"
                  min={0}
                  step="any"
                  required
                  autoFocus
                  value={newStockInput}
                  onChange={(e) => {
                    setNewStockInput(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder={`Enter qty in ${unit}`}
                  className="w-full pl-3 pr-14 py-2.5 text-sm font-mono font-bold text-stone-900 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/30 focus:border-[#FF5A1F]"
                />
                <span className="absolute right-3 top-2.5 text-xs font-bold text-stone-400 select-none">
                  {unit}
                </span>
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                Enter 0 or any positive quantity. Negative stock is not allowed.
              </p>
            </div>

            <div>
              <span className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider mb-1.5">
                Difference (Auto)
              </span>
              <div
                id="edit-stock-difference-display"
                className={`h-[42px] px-3 rounded-lg border flex items-center justify-between font-mono text-sm font-extrabold ${
                  !parsedDraft.isValidNumber || parsedDraft.diff === null
                    ? 'bg-stone-50 border-stone-200 text-stone-400'
                    : parsedDraft.value !== null && parsedDraft.value < 0
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : isIncrease
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : isDecrease
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-stone-50 border-stone-200 text-stone-600'
                }`}
              >
                <span>
                  {!parsedDraft.isValidNumber || parsedDraft.diff === null
                    ? '—'
                    : parsedDraft.value !== null && parsedDraft.value < 0
                    ? 'Invalid'
                    : `${formatSignedStockDifference(parsedDraft.diff)} ${unit}`}
                </span>
                {parsedDraft.isValidNumber && parsedDraft.value !== null && parsedDraft.value >= 0 && (
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wide">
                    {isIncrease ? 'Increase' : isDecrease ? 'Decrease' : 'No Change'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                {isIncrease
                  ? 'Recorded as a positive stock adjustment.'
                  : isDecrease
                  ? 'Recorded as a negative stock adjustment.'
                  : 'Change quantity to record an adjustment.'}
              </p>
            </div>
          </div>

          {/* Significant Difference Warning */}
          {significantWarning.isSignificant && significantWarning.message && (
            <div
              id="edit-stock-significant-warning"
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                significantWarning.severity === 'high'
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  significantWarning.severity === 'high' ? 'text-rose-600' : 'text-amber-600'
                }`}
              />
              <div>
                <p className="font-bold">Significant Stock Difference Warning</p>
                <p className="mt-0.5 leading-relaxed">{significantWarning.message}</p>
              </div>
            </div>
          )}

          {/* Adjustment Reason Selector */}
          <div>
            <label
              htmlFor="edit-stock-reason-select"
              className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider mb-1.5"
            >
              Adjustment Reason *
            </label>
            <select
              id="edit-stock-reason-select"
              required
              value={reasonOption}
              onChange={(e) => {
                setReasonOption(e.target.value as StockAdjustmentReasonOption);
                if (formError) setFormError(null);
              }}
              className="w-full px-3 py-2.5 text-xs font-medium text-stone-900 border border-stone-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/30 focus:border-[#FF5A1F]"
            >
              {STOCK_ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Reason Field when "Other" is selected */}
          {reasonOption === 'Other' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="edit-stock-custom-reason-input"
                  className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider"
                >
                  Specify Reason *
                </label>
                <span className="text-[10px] text-stone-400 font-mono">
                  {customReason.trim().length}/250
                </span>
              </div>
              <textarea
                id="edit-stock-custom-reason-input"
                rows={2}
                maxLength={250}
                required
                placeholder="Explain why the current stock quantity is being corrected..."
                value={customReason}
                onChange={(e) => {
                  setCustomReason(e.target.value);
                  if (formError) setFormError(null);
                }}
                className="w-full px-3 py-2 text-xs text-stone-900 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/30 focus:border-[#FF5A1F]"
              />
            </div>
          )}

          {/* Valuation Protection Notice */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-[#0D2149] shrink-0 mt-0.5" />
            <span>
              Manual stock adjustments update quantity only. Weighted Average Cost (WAC), last purchase rate, vendor balances, and historical purchase bills remain untouched.
            </span>
          </div>

          {formError && (
            <div
              id="edit-stock-error-banner"
              className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
            <button
              id="edit-stock-cancel-btn"
              type="button"
              onClick={handleCloseSafely}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 rounded-lg border border-stone-200 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              id="edit-stock-review-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#e24c16] text-white text-xs font-bold shadow-xs transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Review &amp; Confirm</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      ) : (
        /* Step 2: Explicit Confirmation Dialog */
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Item Name
                </span>
                <p className="text-sm font-bold text-[#0D2149] mt-0.5">{item.name}</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#0D2149]/10 text-[#0D2149] font-bold text-[11px]">
                {unit}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 items-center text-center py-1">
              <div className="p-2.5 rounded-lg bg-white border border-stone-200">
                <span className="text-[10px] uppercase text-stone-400 font-semibold block">
                  Previous
                </span>
                <span className="text-sm font-mono font-bold text-stone-800 block mt-0.5">
                  {formatStockQuantity(currentStock)} {unit}
                </span>
              </div>

              <div className="flex flex-col items-center justify-center">
                <span
                  className={`px-2 py-0.5 rounded-md font-mono font-extrabold text-xs ${
                    (validationPreview.difference || 0) > 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {formatSignedStockDifference(validationPreview.difference || 0)} {unit}
                </span>
                <span className="text-[10px] text-stone-400 mt-1">
                  {(validationPreview.difference || 0) > 0 ? 'Stock Increase' : 'Stock Decrease'}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-[#0D2149] text-white">
                <span className="text-[10px] uppercase text-slate-300 font-semibold block">
                  New Stock
                </span>
                <span className="text-sm font-mono font-extrabold text-white block mt-0.5">
                  {formatStockQuantity(validationPreview.newStock ?? 0)} {unit}
                </span>
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-200 space-y-1.5">
              <div className="flex justify-between gap-3">
                <span className="text-stone-500">Adjustment Reason:</span>
                <span className="font-bold text-stone-900 text-right">
                  {validationPreview.resolvedReason}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-stone-500">Adjusted By:</span>
                <span className="font-semibold text-stone-800 text-right">
                  {actorName} {actorRole ? `(${actorRole.replace('_', ' ')})` : ''}
                </span>
              </div>
            </div>
          </div>

          {significantWarning.isSignificant && significantWarning.message && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-medium">{significantWarning.message}</p>
            </div>
          )}

          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 text-[11px] text-emerald-900 flex items-start gap-2">
            <PackageCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>
              An immutable stock adjustment entry will be recorded in the audit ledger. WAC, purchase rates, and vendor payables will not change.
            </span>
          </div>

          {formError && (
            <div
              id="edit-stock-confirm-error-banner"
              className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
            <button
              id="edit-stock-back-btn"
              type="button"
              disabled={submitting}
              onClick={() => {
                setFormError(null);
                setStep('edit');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 rounded-lg border border-stone-200 disabled:opacity-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <button
              id="edit-stock-confirm-save-btn"
              type="button"
              disabled={submitting}
              onClick={handleConfirmSave}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold shadow-xs disabled:opacity-60 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Adjustment...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#FF5A1F]" />
                  <span>Confirm &amp; Save Stock</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
