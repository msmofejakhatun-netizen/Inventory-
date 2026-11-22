export interface UnitOfMeasureOption {
  value: string;
  label: string;
}

/**
 * Supported Units of Measure in STOQO.
 * Stored values match the compact unit string persisted in Firestore (`item.unit`)
 * to preserve full backward compatibility with existing inventory items and transactions.
 */
export const UNIT_OF_MEASURE_OPTIONS: readonly UnitOfMeasureOption[] = [
  { value: 'Kg', label: 'Kg' },
  { value: 'Ltr', label: 'Ltr' },
  { value: 'Gm', label: 'Gm' },
  { value: 'Ml', label: 'Ml' },
  { value: 'Pcs', label: 'Pcs' },
  { value: 'PKT', label: 'Packet (PKT)' },
  { value: 'Box', label: 'Box' },
  { value: 'Tin', label: 'Tin' },
  { value: 'Bottle', label: 'Bottle' },
] as const;

export const SUPPORTED_UOM_VALUES: readonly string[] = UNIT_OF_MEASURE_OPTIONS.map((opt) => opt.value);

export function isSupportedUnit(unit: string | undefined | null): boolean {
  if (!unit) return false;
  return SUPPORTED_UOM_VALUES.includes(unit.trim());
}

/**
 * Normalizes unit strings from CSV imports while preserving existing units untouched.
 * Never performs automatic unit conversions.
 */
export function normalizeImportedUnit(rawUnit: string | undefined | null): string {
  const trimmed = String(rawUnit || '').trim();
  if (!trimmed) return 'Kg';
  const lower = trimmed.toLowerCase();
  if (lower === 'pkt' || lower === 'packet' || lower === 'packet (pkt)') {
    return 'PKT';
  }
  return trimmed;
}
