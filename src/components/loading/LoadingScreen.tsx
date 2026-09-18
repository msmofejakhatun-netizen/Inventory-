import React, { useEffect, useState } from 'react';
import { Boxes, Package, Cloud, ShieldCheck, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

export type LoadingStage = 'connecting' | 'authenticating' | 'fetching_data' | 'syncing_inventory' | 'ready';

export interface LoadingScreenProps {
  /**
   * Whether the background initialization and Firebase auth/data state is ready
   */
  isReady: boolean;
  /**
   * Current loading stage if known
   */
  stage?: LoadingStage;
  /**
   * Measured or calculated progress percentage (0 - 100)
   */
  progress?: number;
  /**
   * Error message if Firebase or network initialization failed
   */
  error?: string | null;
  /**
   * Callback invoked when user clicks the Retry button
   */
  onRetry?: () => void;
  /**
   * Callback invoked when transition out animation completes and the screen should unmount
   */
  onComplete?: () => void;
}

/**
 * Subtle Decorative Background SVG Line-Art Elements around edges
 */
const DecorativeBackground: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden select-none" aria-hidden="true">
    {/* Subtle warm center radial vignette */}
    <div
      className="absolute inset-0 opacity-70"
      style={{
        background: 'radial-gradient(ellipse at 50% 36%, rgba(245, 158, 11, 0.08) 0%, rgba(13, 14, 18, 0.85) 55%, #08080a 100%)',
      }}
    />

    {/* Subtle dot matrix grid */}
    <div
      className="absolute inset-0 opacity-[0.04]"
      style={{
        backgroundImage: 'radial-gradient(#f59e0b 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    />

    {/* 1. Top-Left: Chef Hat */}
    <div className="absolute top-6 left-6 sm:top-12 sm:left-12 text-amber-400/20 opacity-40 sm:opacity-50 animate-float">
      <svg
        className="w-14 h-14 sm:w-20 sm:h-20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 14h12M6 18h12M6 14v4M18 14v4" />
        <path d="M4 14c-.6-1.5-.2-3.3 1-4.2.4-.3.9-.5 1.4-.5.2-.8.6-1.6 1.3-2.2 1.5-1.3 3.8-1.4 5.3-.2.3-.9.9-1.7 1.8-2.2 1.8-1 4.1-.4 5.2 1.3.4.6.6 1.3.6 2 .9.2 1.8.8 2.3 1.6 1 1.4.9 3.4-.1 4.7-.6.7-1.4 1.2-2.3 1.2H6c-.7 0-1.4-.4-1.8-1" />
      </svg>
    </div>

    {/* 2. Top-Right: Covered Serving Dish / Cloche */}
    <div
      className="absolute top-6 right-6 sm:top-12 sm:right-12 text-stone-300/20 opacity-40 sm:opacity-50"
      style={{ animation: 'float-subtle 4.5s ease-in-out infinite' }}
    >
      <svg
        className="w-14 h-14 sm:w-20 sm:h-20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4v2" />
        <path d="M10 4h4" />
        <path d="M3 18h18" />
        <path d="M4 18a8 8 0 0 1 16 0" />
        <path d="M2 20h20" />
      </svg>
    </div>

    {/* 3. Mid-Left: Fork and Spoon */}
    <div
      className="absolute top-1/2 -translate-y-1/2 left-4 sm:left-10 text-stone-400/20 opacity-30 sm:opacity-45 hidden xs:block"
      style={{ animation: 'float-subtle 5.2s ease-in-out infinite' }}
    >
      <svg
        className="w-12 h-12 sm:w-16 sm:h-16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 2v4a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3V2" />
        <path d="M15 9v13" />
        <path d="M5 2c1.7 0 3 1.8 3 4s-1.3 4-3 4-3-1.8-3-4 1.3-4 3-4Z" />
        <path d="M5 10v12" />
      </svg>
    </div>

    {/* 4. Bottom-Left: Vegetables / Fresh Produce */}
    <div
      className="absolute bottom-16 left-6 sm:bottom-14 sm:left-12 text-amber-500/20 opacity-35 sm:opacity-45"
      style={{ animation: 'float-subtle 4.8s ease-in-out infinite 0.5s' }}
    >
      <svg
        className="w-14 h-14 sm:w-18 sm:h-18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7z" />
        <path d="M8.64 14l-2.05-2.04" />
        <path d="M15.36 15.36l4.95-4.95" />
        <path d="M16 8l5-5" />
        <path d="M17.5 4.5l3 3" />
      </svg>
    </div>

    {/* 5. Mid-Right: Store Inventory Package / Box */}
    <div
      className="absolute top-1/2 -translate-y-1/2 right-4 sm:right-10 text-amber-400/20 opacity-35 sm:opacity-45 hidden xs:block"
      style={{ animation: 'float-subtle 5s ease-in-out infinite 1s' }}
    >
      <svg
        className="w-12 h-12 sm:w-16 sm:h-16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    </div>

    {/* 6. Bottom-Right: Cloud Sync & Security Shield */}
    <div
      className="absolute bottom-16 right-6 sm:bottom-14 sm:right-12 text-stone-300/20 opacity-35 sm:opacity-45"
      style={{ animation: 'float-subtle 4.2s ease-in-out infinite 1.2s' }}
    >
      <svg
        className="w-14 h-14 sm:w-18 sm:h-18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        <path d="M12 13v4" />
        <path d="m10 15 2 2 2-2" />
      </svg>
    </div>
  </div>
);

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  isReady,
  stage = 'connecting',
  progress,
  error,
  onRetry,
  onComplete,
}) => {
  // Smooth percentage calculation connected to real initialization progress
  const [internalProgress, setInternalProgress] = useState(25);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showCheckmarks, setShowCheckmarks] = useState(false);

  // Sync internal progress with real stages or provided progress
  useEffect(() => {
    if (error) return;

    if (isReady) {
      // Reached completion: animate to 100%, show verified state, then smoothly exit
      setInternalProgress(100);
      setShowCheckmarks(true);

      const completeTimer = setTimeout(() => {
        setIsFadingOut(true);
      }, 420);

      const unmountTimer = setTimeout(() => {
        if (onComplete) onComplete();
      }, 820);

      return () => {
        clearTimeout(completeTimer);
        clearTimeout(unmountTimer);
      };
    }

    if (typeof progress === 'number') {
      setInternalProgress(Math.min(95, Math.max(15, progress)));
      return;
    }

    // Stage-based progress calculation based on actual initialization tasks
    switch (stage) {
      case 'connecting':
        setInternalProgress(28);
        break;
      case 'authenticating':
        setInternalProgress(52);
        break;
      case 'fetching_data':
        setInternalProgress(74);
        break;
      case 'syncing_inventory':
        setInternalProgress(90);
        break;
      case 'ready':
        setInternalProgress(100);
        break;
      default:
        setInternalProgress(35);
    }
  }, [isReady, stage, progress, error, onComplete]);

  // Derive message details from actual state
  const getSubMessage = () => {
    if (error) return 'Please check your internet connection and try again.';
    if (isReady || showCheckmarks) return 'Secure connection established. Launching system...';
    switch (stage) {
      case 'connecting':
        return 'Connecting to Firebase Database...';
      case 'authenticating':
        return 'Verifying secure staff credentials...';
      case 'fetching_data':
        return 'Fetching latest store configuration & data...';
      case 'syncing_inventory':
        return 'Syncing restaurant store inventory...';
      default:
        return 'Connecting to Firebase Database';
    }
  };

  // Card 1: SYNCING INVENTORY
  const isInventoryActive = !error && !showCheckmarks && stage === 'syncing_inventory';
  const isInventoryDone = !error && (showCheckmarks || internalProgress >= 95);

  // Card 2: FETCHING LATEST DATA
  const isDataActive = !error && !showCheckmarks && (stage === 'fetching_data' || (internalProgress >= 50 && internalProgress < 90));
  const isDataDone = !error && (showCheckmarks || internalProgress >= 90);

  // Card 3: SECURE CONNECTION
  const isConnectionActive = !error && !showCheckmarks && (stage === 'connecting' || stage === 'authenticating' || internalProgress < 50);
  const isConnectionDone = !error && (showCheckmarks || internalProgress >= 50);

  return (
    <div
      id="app-loading-screen"
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 min-h-screen w-full bg-[#08080a] text-white flex flex-col justify-between items-center px-4 py-8 sm:p-10 select-none overflow-x-hidden overflow-y-auto transition-all duration-400 ease-out ${
        isFadingOut ? 'opacity-0 scale-[0.985] pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Decorative Line-Art Background */}
      <DecorativeBackground />

      {/* Top Spacer for responsive centering */}
      <div className="w-full h-2 sm:h-6" />

      {/* Main Center Content Box */}
      <div className="relative z-10 w-full max-w-lg mx-auto flex flex-col items-center text-center">
        {/* CENTER HERO: Logo inside large glowing multicolor loading ring */}
        <div className="relative w-52 h-52 sm:w-64 sm:h-64 flex items-center justify-center mb-6 sm:mb-8">
          {/* 1. Outer subtle segmented instrument track */}
          <div
            className="absolute inset-0 rounded-full border border-stone-800/70 opacity-60"
            style={{
              animation: 'spin-reverse-smooth 24s linear infinite',
              borderStyle: 'dashed',
            }}
          />

          {/* 2. Soft multicolor neon glow blur backdrop */}
          <div
            className="absolute inset-2 sm:inset-3 rounded-full opacity-60 pointer-events-none"
            style={{
              background:
                'conic-gradient(from 0deg, #f59e0b 0%, #ea580c 18%, #ec4899 38%, #8b5cf6 58%, #3b82f6 78%, #06b6d4 92%, #f59e0b 100%)',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 6px), #fff calc(100% - 5px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 6px), #fff calc(100% - 5px))',
              animation: 'spin-smooth 3.2s linear infinite',
              filter: 'blur(7px)',
            }}
          />

          {/* 3. The primary glowing multicolor animated gradient ring */}
          <div
            className="absolute inset-2 sm:inset-3 rounded-full pointer-events-none"
            style={{
              background:
                'conic-gradient(from 0deg, #f59e0b 0%, #ea580c 18%, #ec4899 38%, #8b5cf6 58%, #3b82f6 78%, #06b6d4 92%, #f59e0b 100%)',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 4.5px), #fff calc(100% - 4px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 4.5px), #fff calc(100% - 4px))',
              animation: 'spin-smooth 3.2s linear infinite',
              filter: 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.5)) drop-shadow(0 0 16px rgba(236, 72, 153, 0.35))',
            }}
          />

          {/* 4. Center Logo Container: Premium rounded-square container with warm amber/golden glow */}
          <div
            id="loading-logo-container"
            className="relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-stone-950 flex flex-col items-center justify-center p-2 border border-amber-300/40"
            style={{
              animation: 'pulse-glow 2.8s ease-in-out infinite',
            }}
          >
            {/* Store Boxes Icon */}
            <Boxes className="w-7 h-7 sm:w-8 sm:h-8 text-stone-950 stroke-[2.2] mb-0.5 drop-shadow-xs" />
            {/* Existing RC Monogram */}
            <span className="text-xl sm:text-2xl font-black tracking-tight leading-none text-stone-950 drop-shadow-xs">
              RC
            </span>
          </div>
        </div>

        {/* MAIN BRAND TEXT */}
        <div className="space-y-0.5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-[0.2em] uppercase leading-tight">
            RESTAURANT STORE
          </h1>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-amber-400 tracking-[0.2em] uppercase leading-tight bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
            CONTROL SYSTEM
          </h2>
        </div>

        {/* Tagline */}
        <p className="text-[10px] sm:text-xs font-bold text-amber-100/75 tracking-[0.26em] uppercase mt-2.5">
          "KNOW YOUR STOCK. CONTROL YOUR CASH."
        </p>

        {/* Thin warm amber horizontal divider */}
        <div className="w-36 sm:w-48 h-[1.5px] bg-gradient-to-r from-transparent via-amber-500/70 to-transparent my-4 sm:my-5 mx-auto" />

        {/* LOADING MESSAGE */}
        <div className="min-h-[52px] flex flex-col items-center justify-center">
          <h3 className="text-base sm:text-lg font-semibold text-white tracking-wide">
            {error ? 'Unable to connect' : showCheckmarks ? 'Data Verified & Ready' : 'Loading your data...'}
          </h3>
          <p className="text-xs sm:text-sm text-stone-400 mt-1 font-normal max-w-sm">
            {getSubMessage()}
          </p>
        </div>

        {/* ERROR STATE ACTION */}
        {error ? (
          <div className="mt-5 flex flex-col items-center">
            <button
              id="loading-retry-button"
              type="button"
              onClick={onRetry}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs tracking-wider uppercase shadow-lg shadow-amber-500/20 transition-all active:scale-95 flex items-center gap-2 cursor-pointer border border-amber-300/40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Connection
            </button>
            <p className="text-[11px] text-stone-500 mt-2">
              Server status: checking connectivity
            </p>
          </div>
        ) : (
          /* REAL PROGRESS BAR */
          <div className="w-full max-w-sm sm:max-w-md mt-4 sm:mt-5 px-1 sm:px-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2.5 sm:h-3 rounded-full bg-stone-900/90 border border-stone-800/90 p-0.5 overflow-hidden relative shadow-inner">
                <div
                  id="loading-progress-fill"
                  className="h-full rounded-full transition-all duration-400 ease-out bg-gradient-to-r from-amber-500 via-pink-500 via-purple-500 via-blue-500 to-cyan-400 relative overflow-hidden"
                  style={{
                    width: `${internalProgress}%`,
                    boxShadow: '0 0 12px rgba(236, 72, 153, 0.45)',
                  }}
                >
                  {/* Subtle animated shimmer highlight */}
                  <div
                    className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    style={{ animation: 'shimmer-slide 2.2s infinite' }}
                  />
                </div>
              </div>

              {/* Progress Percentage */}
              <span
                id="loading-progress-percent"
                className="text-xs sm:text-sm font-bold text-amber-400 w-11 text-right tabular-nums"
              >
                {Math.round(internalProgress)}%
              </span>
            </div>
          </div>
        )}

        {/* LOADING STATUS CARDS (3 evenly spaced) */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3.5 w-full max-w-sm sm:max-w-md mt-5">
          {/* 1. SYNCING INVENTORY */}
          <div
            id="status-card-inventory"
            className={`p-2.5 sm:p-3 rounded-xl border flex flex-col items-center text-center transition-all duration-300 ${
              isInventoryDone
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                : isInventoryActive
                ? 'bg-amber-950/30 border-amber-500/60 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.2)]'
                : 'bg-stone-900/40 border-stone-800/60 text-stone-500'
            }`}
          >
            <div className="relative mb-1.5">
              {isInventoryDone ? (
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              ) : (
                <Package
                  className={`w-4 h-4 sm:w-5 sm:h-5 ${
                    isInventoryActive ? 'animate-bounce text-amber-400' : 'text-stone-500'
                  }`}
                />
              )}
            </div>
            <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase leading-tight">
              SYNCING
              <br />
              INVENTORY
            </span>
          </div>

          {/* 2. FETCHING LATEST DATA */}
          <div
            id="status-card-data"
            className={`p-2.5 sm:p-3 rounded-xl border flex flex-col items-center text-center transition-all duration-300 ${
              isDataDone
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                : isDataActive
                ? 'bg-amber-950/30 border-amber-500/60 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.2)]'
                : 'bg-stone-900/40 border-stone-800/60 text-stone-500'
            }`}
          >
            <div className="relative mb-1.5">
              {isDataDone ? (
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              ) : (
                <Cloud
                  className={`w-4 h-4 sm:w-5 sm:h-5 ${
                    isDataActive ? 'animate-pulse text-amber-400' : 'text-stone-500'
                  }`}
                />
              )}
            </div>
            <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase leading-tight">
              FETCHING
              <br />
              LATEST DATA
            </span>
          </div>

          {/* 3. SECURE CONNECTION */}
          <div
            id="status-card-security"
            className={`p-2.5 sm:p-3 rounded-xl border flex flex-col items-center text-center transition-all duration-300 ${
              error
                ? 'bg-rose-950/20 border-rose-500/40 text-rose-400'
                : isConnectionDone
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                : isConnectionActive
                ? 'bg-cyan-950/30 border-cyan-500/60 text-cyan-300 shadow-[0_0_14px_rgba(6,182,212,0.2)]'
                : 'bg-stone-900/40 border-stone-800/60 text-stone-500'
            }`}
          >
            <div className="relative mb-1.5">
              {error ? (
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" />
              ) : isConnectionDone ? (
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              ) : (
                <ShieldCheck
                  className={`w-4 h-4 sm:w-5 sm:h-5 ${
                    isConnectionActive ? 'animate-pulse text-cyan-400' : 'text-stone-500'
                  }`}
                />
              )}
            </div>
            <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase leading-tight">
              SECURE
              <br />
              CONNECTION
            </span>
          </div>
        </div>
      </div>

      {/* BOTTOM QUOTE: "Good Food Better Business" */}
      <div className="relative z-10 text-center mt-6">
        <p
          className="italic text-xs sm:text-sm text-stone-300/80 tracking-wider"
          style={{ fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif" }}
        >
          "Good Food Better Business"
        </p>
        <div className="w-20 h-[1px] bg-gradient-to-r from-transparent via-amber-500/60 to-transparent mx-auto mt-1" />
      </div>
    </div>
  );
};
