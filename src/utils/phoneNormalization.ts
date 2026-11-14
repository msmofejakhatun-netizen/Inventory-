export interface CountryDialOption {
  code: 'IN' | 'AE' | 'US' | 'GB';
  name: string;
  dialCode: '+91' | '+971' | '+1' | '+44';
  digitsPrefix: string;
  placeholder: string;
  expectedDigits: number;
}

export const SUPPORTED_COUNTRIES: CountryDialOption[] = [
  {
    code: 'IN',
    name: 'India',
    dialCode: '+91',
    digitsPrefix: '91',
    placeholder: '98004 63754',
    expectedDigits: 10,
  },
  {
    code: 'AE',
    name: 'UAE',
    dialCode: '+971',
    digitsPrefix: '971',
    placeholder: '50 123 4567',
    expectedDigits: 9,
  },
  {
    code: 'US',
    name: 'USA',
    dialCode: '+1',
    digitsPrefix: '1',
    placeholder: '415 555 2671',
    expectedDigits: 10,
  },
  {
    code: 'GB',
    name: 'UK',
    dialCode: '+44',
    digitsPrefix: '44',
    placeholder: '7911 123456',
    expectedDigits: 10,
  },
];

export interface PhoneNormalizationResult {
  isValid: boolean;
  e164: string;
  nationalNumber: string;
  error?: string;
}

/**
 * Normalizes and validates a user-entered phone number into strict Firebase E.164 format.
 * Prevents duplicate country codes (e.g. handles 9800463754, +919800463754, 919800463754 -> +919800463754).
 */
export function normalizeAndValidatePhoneNumber(
  rawInput: string,
  countryCode: CountryDialOption['code'] = 'IN'
): PhoneNormalizationResult {
  const country =
    SUPPORTED_COUNTRIES.find((c) => c.code === countryCode) || SUPPORTED_COUNTRIES[0];

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      isValid: false,
      e164: '',
      nationalNumber: '',
      error: `Please enter your ${country.expectedDigits}-digit mobile number.`,
    };
  }

  // Reject clearly invalid characters (letters, etc.) while allowing spaces, hyphens, parentheses, leading +
  if (/[a-zA-Z]/.test(trimmed)) {
    return {
      isValid: false,
      e164: '',
      nationalNumber: '',
      error: 'Phone number must contain only digits.',
    };
  }

  const hasPlusPrefix = trimmed.startsWith('+');
  // Strip all non-digit characters
  let digits = trimmed.replace(/\D/g, '');

  if (!digits) {
    return {
      isValid: false,
      e164: '',
      nationalNumber: '',
      error: `Please enter a valid ${country.name} mobile number.`,
    };
  }

  // If user typed a different +<countryCode> than the selected dropdown
  if (hasPlusPrefix && !digits.startsWith(country.digitsPrefix)) {
    return {
      isValid: false,
      e164: '',
      nationalNumber: '',
      error: `Entered country code does not match selected country (${country.name} ${country.dialCode}). Please switch the country selector or remove the extra prefix.`,
    };
  }

  // Strip country prefix safely to prevent duplicate country codes (e.g. +9191... or 919800463754)
  if (hasPlusPrefix && digits.startsWith(country.digitsPrefix)) {
    digits = digits.slice(country.digitsPrefix.length);
  } else if (
    digits.startsWith(country.digitsPrefix) &&
    digits.length > country.expectedDigits
  ) {
    // Handle formats like 919800463754 (12 digits for India) or 971501234567 (12 digits for UAE)
    digits = digits.slice(country.digitsPrefix.length);
  }

  // Strip a single trunk '0' prefix if present (e.g. 09800463754 or 07911123456)
  if (digits.startsWith('0') && digits.length === country.expectedDigits + 1) {
    digits = digits.slice(1);
  }

  // Country-specific strict validation before calling Firebase
  if (country.code === 'IN') {
    if (digits.length < 10) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: `Incomplete Indian mobile number (${digits.length}/10 digits). Please enter all 10 digits.`,
      };
    }
    if (digits.length > 10) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: 'Indian mobile number must be exactly 10 digits after +91.',
      };
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: 'Please enter a valid 10-digit Indian mobile number (must start with 6, 7, 8, or 9).',
      };
    }
  } else if (country.code === 'AE') {
    if (digits.length !== 9) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: `Please enter a valid 9-digit UAE mobile number after +971 (currently ${digits.length} digits).`,
      };
    }
  } else if (country.code === 'US') {
    if (digits.length !== 10) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: `Please enter a valid 10-digit US phone number after +1 (currently ${digits.length} digits).`,
      };
    }
  } else if (country.code === 'GB') {
    if (digits.length !== 10) {
      return {
        isValid: false,
        e164: '',
        nationalNumber: digits,
        error: `Please enter a valid 10-digit UK mobile number after +44 (currently ${digits.length} digits).`,
      };
    }
  }

  return {
    isValid: true,
    e164: `${country.dialCode}${digits}`,
    nationalNumber: digits,
  };
}
