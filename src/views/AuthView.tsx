import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Phone, CheckCircle2, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { ConfirmationResult } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { StoqoLogo } from '../components/brand/StoqoLogo';
import { LegalFooter } from '../components/layout/LegalFooter';
import {
  SUPPORTED_COUNTRIES,
  CountryDialOption,
  normalizeAndValidatePhoneNumber,
} from '../utils/phoneNormalization';

function formatFirebasePhoneError(err: any): string {
  const code = err?.code || '';
  const rawMessage = err?.message || '';

  if (code === 'auth/invalid-phone-number' || rawMessage.includes('auth/invalid-phone-number')) {
    return 'Firebase rejected the phone number format (auth/invalid-phone-number). Please verify your country code and mobile digits.';
  }
  if (code === 'auth/too-many-requests' || rawMessage.includes('auth/too-many-requests')) {
    return 'Too many OTP attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/captcha-check-failed' || rawMessage.includes('auth/captcha-check-failed')) {
    return 'reCAPTCHA verification failed. Please refresh the page and try again.';
  }
  if (code === 'auth/operation-not-allowed' || rawMessage.includes('auth/operation-not-allowed')) {
    return 'Phone Authentication is not enabled in Firebase Console for this project.';
  }
  if (code === 'auth/quota-exceeded' || rawMessage.includes('auth/quota-exceeded')) {
    return 'SMS quota exceeded for this Firebase project. Please try again later.';
  }
  if (code === 'auth/invalid-verification-code' || rawMessage.includes('auth/invalid-verification-code')) {
    return 'Invalid 6-digit verification code. Please check the SMS and try again.';
  }
  if (code === 'auth/code-expired' || rawMessage.includes('auth/code-expired')) {
    return 'Verification code has expired. Please request a new OTP.';
  }
  return rawMessage || 'Failed to send verification code. Please check your phone number.';
}

export const AuthView: React.FC = () => {
  const { loginWithGoogle, setUpPhoneRecaptcha, sendPhoneOtp, error: authError, clearError } = useAuth();

  const [authMode, setAuthMode] = useState<'google' | 'phone'>('google');
  const [countryCode, setCountryCode] = useState<CountryDialOption['code']>('IN');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [sentE164Number, setSentE164Number] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const selectedCountry = useMemo(
    () => SUPPORTED_COUNTRIES.find((c) => c.code === countryCode) || SUPPORTED_COUNTRIES[0],
    [countryCode]
  );

  const normalizedPreview = useMemo(
    () => normalizeAndValidatePhoneNumber(phoneNumber, countryCode),
    [phoneNumber, countryCode]
  );

  useEffect(() => {
    setLocalError(null);
    clearError();
  }, [authMode]);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setLocalError(null);
      clearError();
      await loginWithGoogle();
    } catch (err: any) {
      setLocalError(err?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const validation = normalizeAndValidatePhoneNumber(phoneNumber, countryCode);
    if (!validation.isValid) {
      setLocalError(validation.error || 'Please enter a valid mobile number.');
      return;
    }

    try {
      setLoading(true);
      setLocalError(null);
      const recaptcha = setUpPhoneRecaptcha('recaptcha-container');
      const confirmation = await sendPhoneOtp(validation.e164, recaptcha);
      setSentE164Number(validation.e164);
      setConfirmationResult(confirmation);
      setIsOtpSent(true);
    } catch (err: any) {
      setIsOtpSent(false);
      setConfirmationResult(null);
      setLocalError(formatFirebasePhoneError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const cleanedOtp = otpCode.replace(/\D/g, '');
    if (!cleanedOtp || cleanedOtp.length !== 6 || !confirmationResult) {
      setLocalError('Please enter the 6-digit verification code.');
      return;
    }

    try {
      setLoading(true);
      setLocalError(null);
      await confirmationResult.confirm(cleanedOtp);
    } catch (err: any) {
      setLocalError(formatFirebasePhoneError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-between">
      {/* reCAPTCHA anchor */}
      <div id="recaptcha-container"></div>

      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <StoqoLogo variant="full" theme="light" size="lg" showTagline={true} />
        <p className="mt-2 text-xs text-stone-500">
          Restaurant Inventory & Store Management SaaS
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-stone-200 sm:px-10">
          {/* Error Banner */}
          {(localError || authError) && (
            <div className="mb-6 p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{localError || authError}</span>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex rounded-lg bg-stone-100 p-1 mb-6 border border-stone-200">
            <button
              id="auth-mode-google-btn"
              type="button"
              onClick={() => {
                setAuthMode('google');
                setIsOtpSent(false);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                authMode === 'google'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Google Account
            </button>
            <button
              id="auth-mode-phone-btn"
              type="button"
              onClick={() => setAuthMode('phone')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                authMode === 'phone'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Phone OTP
            </button>
          </div>

          {authMode === 'google' ? (
            <div className="space-y-4">
              <p className="text-xs text-stone-500 text-center leading-relaxed">
                Sign in securely to manage stock ledger, purchase entries, and multi-outlet operations.
              </p>

              <button
                id="google-signin-btn"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-stone-300 rounded-xl text-sm font-semibold text-stone-700 hover:bg-stone-50 hover:border-stone-400 transition-all shadow-2xs disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-stone-600" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>Continue with Google</span>
              </button>
            </div>
          ) : !isOtpSent ? (
            <form onSubmit={handleSendPhoneOtp} className="space-y-4">
              <div>
                <label
                  htmlFor="phone-input"
                  className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1"
                >
                  Mobile Number
                </label>
                <div className="flex rounded-xl border border-stone-300 shadow-2xs focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 overflow-hidden bg-white">
                  <select
                    id="country-code-select"
                    aria-label="Country code"
                    value={countryCode}
                    onChange={(e) => {
                      setCountryCode(e.target.value as CountryDialOption['code']);
                      setLocalError(null);
                      clearError();
                    }}
                    className="bg-stone-50 border-r border-stone-200 px-2.5 py-2 text-xs font-semibold text-stone-800 focus:outline-none cursor-pointer"
                  >
                    {SUPPORTED_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.dialCode})
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1 flex items-center">
                    <div className="pl-2.5 flex items-center pointer-events-none text-stone-400">
                      <Phone className="w-3.5 h-3.5" />
                    </div>
                    <input
                      id="phone-input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      placeholder={selectedCountry.placeholder}
                      value={phoneNumber}
                      onChange={(e) => {
                        setPhoneNumber(e.target.value);
                        if (localError) setLocalError(null);
                        if (authError) clearError();
                      }}
                      className="block w-full pl-2 pr-3 py-2 text-sm text-stone-900 focus:outline-none placeholder-stone-400"
                    />
                  </div>
                </div>
                {normalizedPreview.isValid ? (
                  <p className="mt-1.5 text-[11px] text-emerald-700 font-medium">
                    Normalized Firebase format: <span className="font-mono font-bold">{normalizedPreview.e164}</span>
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-stone-500">
                    Enter your {selectedCountry.expectedDigits}-digit {selectedCountry.name} mobile number — {selectedCountry.dialCode} is added automatically.
                  </p>
                )}
              </div>

              <button
                id="send-otp-btn"
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                <span>Send Verification Code</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="otp-input"
                    className="block text-xs font-semibold text-stone-700 uppercase tracking-wider"
                  >
                    Enter 6-Digit SMS Code
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOtpSent(false);
                      setOtpCode('');
                      setLocalError(null);
                      clearError();
                    }}
                    className="text-[11px] text-amber-600 hover:underline"
                  >
                    Change Number
                  </button>
                </div>
                {sentE164Number && (
                  <p className="text-[11px] text-stone-500 mb-2">
                    OTP sent to <span className="font-mono font-semibold text-stone-800">{sentE164Number}</span>
                  </p>
                )}
                <input
                  id="otp-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => {
                    setOtpCode(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  className="block w-full text-center tracking-widest text-lg font-bold px-3 py-2 border border-stone-300 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <button
                id="verify-otp-btn"
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Verify & Sign In</span>
              </button>
            </form>
          )}

          {/* Feature Highlights */}
          <div className="mt-6 pt-6 border-t border-stone-100">
            <div className="space-y-2 text-xs text-stone-600">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Weighted Average Costing inventory engine</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>AI purchase price guard and price hike alerts</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>14-day full access trial included (₹799/mo)</span>
              </div>
            </div>

            <p className="mt-5 pt-4 border-t border-stone-100 text-[11px] text-stone-500 text-center leading-relaxed">
              By signing in or creating an account, you agree to STOQO&apos;s{' '}
              <a
                href="/terms-and-conditions"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, '', '/terms-and-conditions');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="font-semibold text-[#0D2149] hover:text-[#FF5A1F] underline underline-offset-2"
              >
                Terms &amp; Conditions
              </a>{' '}
              and acknowledge our{' '}
              <a
                href="/privacy-policy"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, '', '/privacy-policy');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="font-semibold text-[#0D2149] hover:text-[#FF5A1F] underline underline-offset-2"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>
      </div>

      {/* Public Website Footer */}
      <LegalFooter variant="full" />
    </div>
  );
};
