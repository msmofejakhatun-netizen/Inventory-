import React, { useState, useEffect } from 'react';
import { ShieldCheck, Phone, CheckCircle2, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { ConfirmationResult } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';

export const AuthView: React.FC = () => {
  const { loginWithGoogle, setUpPhoneRecaptcha, sendPhoneOtp, error: authError } = useAuth();

  const [authMode, setAuthMode] = useState<'google' | 'phone'>('google');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    // Clear recaptcha container if switching modes
    setLocalError(null);
  }, [authMode]);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setLocalError(null);
      await loginWithGoogle();
    } catch (err: any) {
      setLocalError(err?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber || phoneNumber.length < 10) {
      setLocalError('Please enter a valid phone number with country code (e.g. +919876543210)');
      return;
    }

    try {
      setLoading(true);
      setLocalError(null);
      const recaptcha = setUpPhoneRecaptcha('recaptcha-container');
      const confirmation = await sendPhoneOtp(phoneNumber, recaptcha);
      setConfirmationResult(confirmation);
      setIsOtpSent(true);
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to send OTP. Ensure phone number starts with + and country code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length < 6 || !confirmationResult) {
      setLocalError('Please enter the 6-digit verification code.');
      return;
    }

    try {
      setLoading(true);
      setLocalError(null);
      await confirmationResult.confirm(otpCode);
    } catch (err: any) {
      setLocalError(err?.message || 'Invalid or expired OTP code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      {/* reCAPTCHA anchor */}
      <div id="recaptcha-container"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-14 h-14 bg-amber-500 rounded-2xl mx-auto flex items-center justify-center text-stone-950 font-black text-xl shadow-md">
          RC
        </div>
        <h1 className="mt-4 text-2xl font-black text-stone-900 tracking-tight sm:text-3xl">
          RESTAURANT STORE CONTROL SYSTEM
        </h1>
        <p className="mt-2 text-sm font-semibold text-amber-700 tracking-wide uppercase">
          "Know your stock. Control your cash."
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Raw material inventory, purchase price control, and kitchen consumption audit SaaS
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
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Mobile Number (with Country Code)
                </label>
                <div className="relative rounded-xl border border-stone-300 shadow-2xs focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    id="phone-input"
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2 text-sm text-stone-900 rounded-xl focus:outline-none placeholder-stone-400"
                  />
                </div>
                <p className="mt-1 text-[11px] text-stone-500">Include country code: +91 (India), +971 (UAE), +1 (US), +44 (UK)</p>
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
                  <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
                    Enter 6-Digit SMS Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsOtpSent(false)}
                    className="text-[11px] text-amber-600 hover:underline"
                  >
                    Change Number
                  </button>
                </div>
                <input
                  id="otp-input"
                  type="text"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
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
                <span>14-day full access trial included (₹99/mo)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
