export const STOCK_ADJUSTMENT_REASONS = [
  'Physical Stock Correction',
  'Opening Stock',
  'Stock Found',
  'Stock Missing',
  'Other',
] as const;

export type StockAdjustmentReasonOption = (typeof STOCK_ADJUSTMENT_REASONS)[number];

export const MAX_STOCK_ADJUSTMENT_REASON_LENGTH = 300;
export const MAX_STOCK_QUANTITY = 1_000_000_000;

export interface StockAdjustmentValidationInput {
  currentStock: number;
  newStockInput: string | number;
  reasonOption: string;
  customReason?: string;
}

export interface StockAdjustmentValidationResult {
  valid: boolean;
  error: string | null;
  newStock: number | null;
  difference: number | null;
  adjustmentType: 'INCREASE' | 'DECREASE' | 'NO_CHANGE' | null;
  resolvedReason: string;
}

export interface SignificantDifferenceEvaluation {
  isSignificant: boolean;
  severity: 'warning' | 'high' | null;
  message: string | null;
}

/**
 * Normalizes a numeric stock value to 2 decimal places without floating-point drift.
 */
export function roundStockQuantity(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Formats a stock quantity cleanly (e.g. 10 -> "10", 10.5 -> "10.5", 10.25 -> "10.25").
 */
export function formatStockQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = roundStockQuantity(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Formats a signed stock difference (e.g. "+5", "-2.5", "0").
 */
export function formatSignedStockDifference(diff: number): string {
  if (!Number.isFinite(diff) || diff === 0) return '0';
  const rounded = roundStockQuantity(diff);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${formatStockQuantity(rounded)}`;
}

/**
 * Strictly validates manual current stock adjustment inputs before saving.
 */
export function validateStockAdjustmentInput(
  input: StockAdjustmentValidationInput
): StockAdjustmentValidationResult {
  const safeCurrentStock = Number.isFinite(Number(input.currentStock))
    ? roundStockQuantity(Number(input.currentStock))
    : 0;

  const rawString =
    typeof input.newStockInput === 'number'
      ? String(input.newStockInput)
      : String(input.newStockInput ?? '').trim();

  if (rawString.length === 0) {
    return {
      valid: false,
      error: 'Please enter the new stock quantity.',
      newStock: null,
      difference: null,
      adjustmentType: null,
      resolvedReason: '',
    };
  }

  const parsed = Number(rawString);
  if (!Number.isFinite(parsed)) {
    return {
      valid: false,
      error: 'New stock quantity must be a valid number.',
      newStock: null,
      difference: null,
      adjustmentType: null,
      resolvedReason: '',
    };
  }

  if (parsed < 0) {
    return {
      valid: false,
      error: 'Stock quantity cannot be negative. Enter 0 or a positive value.',
      newStock: null,
      difference: null,
      adjustmentType: null,
      resolvedReason: '',
    };
  }

  if (parsed > MAX_STOCK_QUANTITY) {
    return {
      valid: false,
      error: 'Stock quantity exceeds the maximum allowed limit.',
      newStock: null,
      difference: null,
      adjustmentType: null,
      resolvedReason: '',
    };
  }

  const newStock = roundStockQuantity(parsed);
  const difference = roundStockQuantity(newStock - safeCurrentStock);
  const adjustmentType: 'INCREASE' | 'DECREASE' | 'NO_CHANGE' =
    difference > 0 ? 'INCREASE' : difference < 0 ? 'DECREASE' : 'NO_CHANGE';

  const selectedReason = String(input.reasonOption ?? '').trim();
  const customReason = String(input.customReason ?? '').trim();

  let resolvedReason = '';
  if (!selectedReason) {
    return {
      valid: false,
      error: 'Please select an adjustment reason.',
      newStock,
      difference,
      adjustmentType,
      resolvedReason: '',
    };
  }

  if (selectedReason === 'Other') {
    if (!customReason) {
      return {
        valid: false,
        error: 'Please enter a custom reason when "Other" is selected.',
        newStock,
        difference,
        adjustmentType,
        resolvedReason: '',
      };
    }
    if (customReason.length < 3) {
      return {
        valid: false,
        error: 'Please enter a clearer reason (at least 3 characters).',
        newStock,
        difference,
        adjustmentType,
        resolvedReason: '',
      };
    }
    resolvedReason = `Other: ${customReason}`;
  } else {
    resolvedReason = selectedReason;
  }

  if (resolvedReason.length > MAX_STOCK_ADJUSTMENT_REASON_LENGTH) {
    return {
      valid: false,
      error: `Adjustment reason cannot exceed ${MAX_STOCK_ADJUSTMENT_REASON_LENGTH} characters.`,
      newStock,
      difference,
      adjustmentType,
      resolvedReason,
    };
  }

  if (difference === 0) {
    return {
      valid: false,
      error: 'New stock quantity matches the current stock. Enter a different quantity to record an adjustment.',
      newStock,
      difference,
      adjustmentType,
      resolvedReason,
    };
  }

  return {
    valid: true,
    error: null,
    newStock,
    difference,
    adjustmentType,
    resolvedReason,
  };
}

/**
 * Evaluates whether a manual stock change is unusually large and should display a warning banner.
 */
export function evaluateSignificantStockDifference(
  currentStock: number,
  newStock: number,
  unit: string
): SignificantDifferenceEvaluation {
  if (!Number.isFinite(currentStock) || !Number.isFinite(newStock) || newStock < 0) {
    return { isSignificant: false, severity: null, message: null };
  }

  const prev = roundStockQuantity(currentStock);
  const next = roundStockQuantity(newStock);
  const diff = roundStockQuantity(next - prev);
  const absDiff = Math.abs(diff);

  if (diff === 0) {
    return { isSignificant: false, severity: null, message: null };
  }

  if (prev > 0 && next === 0) {
    return {
      isSignificant: true,
      severity: 'high',
      message: `This adjustment will clear all remaining stock (${formatStockQuantity(prev)} ${unit} → 0 ${unit}). Double-check physical count before confirming.`,
    };
  }

  if (prev > 0) {
    const pctChange = Math.round((absDiff / prev) * 100);
    if (pctChange >= 50) {
      return {
        isSignificant: true,
        severity: pctChange >= 100 ? 'high' : 'warning',
        message: `Large stock change detected: ${formatSignedStockDifference(diff)} ${unit} (${pctChange}% ${diff > 0 ? 'increase' : 'decrease'} from current stock). Please verify before saving.`,
      };
    }
  }

  if (absDiff >= 25) {
    return {
      isSignificant: true,
      severity: 'warning',
      message: `Significant quantity change of ${formatSignedStockDifference(diff)} ${unit}. Please verify the physical count before confirming.`,
    };
  }

  return { isSignificant: false, severity: null, message: null };
}
