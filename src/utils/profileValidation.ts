export const PROFILE_NAME_MIN_LENGTH = 2;
export const PROFILE_NAME_MAX_LENGTH = 60;

export interface DisplayNameValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Trims leading/trailing whitespace and collapses consecutive spaces.
 */
export function normalizeDisplayName(rawName: string): string {
  return String(rawName || '').trim().replace(/\s+/g, ' ');
}

/**
 * Validates and normalizes a user or staff display name.
 * Rejects empty strings, overly short/long names, control characters, and angle brackets.
 */
export function validateDisplayName(rawName: string): DisplayNameValidationResult {
  const normalized = normalizeDisplayName(rawName);

  if (!normalized) {
    return {
      valid: false,
      normalized,
      error: 'Display name cannot be empty.',
    };
  }

  if (normalized.length < PROFILE_NAME_MIN_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `Display name must be at least ${PROFILE_NAME_MIN_LENGTH} characters.`,
    };
  }

  if (normalized.length > PROFILE_NAME_MAX_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `Display name must be ${PROFILE_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }

  if (/[<>\x00-\x1F\x7F]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Display name contains invalid characters.',
    };
  }

  if (!/[\p{L}\p{N}]/u.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Display name must contain at least one letter or number.',
    };
  }

  return {
    valid: true,
    normalized,
  };
}
