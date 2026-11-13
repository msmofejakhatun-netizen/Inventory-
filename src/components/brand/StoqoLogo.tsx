import React from 'react';

interface StoqoLogoProps {
  /**
   * 'full': Complete logo with icon + STOQO wordmark + tagline
   * 'compact': Icon + STOQO wordmark + tagline (horizontal for sidebar/header)
   * 'icon': Square application icon (store/restaurant inspired icon + STOQO mark)
   */
  variant?: 'full' | 'compact' | 'icon';
  /**
   * 'light': For light backgrounds (Deep Navy Blue wordmark)
   * 'dark': For dark backgrounds (White / Light Navy wordmark with Electric Orange accents)
   */
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  className?: string;
}

/**
 * Official STOQO Brand Icon SVG
 * Features Deep Navy Blue (#0B1D3A / #0F2952) and Electric Orange (#FF5A1F / #FF6B00)
 * Restaurant / Store awning + inventory cube + precision upward control motif
 */
export const StoqoIcon: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-10 h-10',
}) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`shrink-0 select-none ${className}`}
    aria-label="STOQO Icon"
  >
    <defs>
      <linearGradient id="stoqoNavyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#132D5E" />
        <stop offset="50%" stopColor="#0D2149" />
        <stop offset="100%" stopColor="#07132B" />
      </linearGradient>
      <linearGradient id="stoqoOrangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FF7A29" />
        <stop offset="50%" stopColor="#FF5A1F" />
        <stop offset="100%" stopColor="#E04107" />
      </linearGradient>
    </defs>

    {/* Rounded Square App Badge in Deep Navy Blue */}
    <rect
      x="4"
      y="4"
      width="112"
      height="112"
      rx="26"
      fill="url(#stoqoNavyGrad)"
      stroke="#FF5A1F"
      strokeWidth="2.5"
      strokeOpacity="0.45"
    />

    {/* Storefront Awning / Restaurant Cloche Top in Electric Orange */}
    <path
      d="M28 36C28 31.5817 31.5817 28 36 28H84C88.4183 28 92 31.5817 92 36V41C92 45.4183 88.4183 49 84 49C79.5817 49 76 45.4183 76 41C76 45.4183 72.4183 49 68 49C63.5817 49 60 45.4183 60 41C60 45.4183 56.4183 49 52 49C47.5817 49 44 45.4183 44 41C44 45.4183 40.4183 49 36 49C31.5817 49 28 45.4183 28 41V36Z"
      fill="url(#stoqoOrangeGrad)"
    />

    {/* Awning Scallop Dividers */}
    <path
      d="M44 28V41M60 28V41M76 28V41"
      stroke="#0D2149"
      strokeWidth="2.5"
      strokeLinecap="round"
    />

    {/* Isometric Store Inventory Cube inside Storefront */}
    {/* Top Diamond Face */}
    <path
      d="M60 54L82 65L60 76L38 65L60 54Z"
      fill="#FF5A1F"
      fillOpacity="0.22"
      stroke="#FF6B2B"
      strokeWidth="3.2"
      strokeLinejoin="round"
    />

    {/* Left Cube Face */}
    <path
      d="M38 65V85L60 96V76L38 65Z"
      fill="#1E3A6E"
      stroke="#FFFFFF"
      strokeWidth="3.2"
      strokeLinejoin="round"
    />

    {/* Right Cube Face */}
    <path
      d="M82 65V85L60 96V76L82 65Z"
      fill="url(#stoqoOrangeGrad)"
      stroke="#FF7A29"
      strokeWidth="3.2"
      strokeLinejoin="round"
    />

    {/* Dynamic Check / Trend Spark on Right */}
    <circle cx="88" cy="24" r="5" fill="#FF5A1F" />
  </svg>
);

/**
 * Official STOQO Brand Logo Component
 * Preserves proportions, readability, Deep Navy Blue & Electric Orange palette,
 * and tagline "Smart Stock. Smarter Business."
 */
export const StoqoLogo: React.FC<StoqoLogoProps> = ({
  variant = 'full',
  theme = 'light',
  size = 'md',
  showTagline = true,
  className = '',
}) => {
  if (variant === 'icon') {
    const iconSizes = {
      sm: 'w-8 h-8',
      md: 'w-11 h-11',
      lg: 'w-14 h-14',
      xl: 'w-20 h-20',
    };
    return <StoqoIcon className={`${iconSizes[size]} ${className}`} />;
  }

  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
        <StoqoIcon className={size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'} />
        <div className="flex flex-col text-left">
          <div className="flex items-baseline tracking-tight leading-none font-black text-lg">
            <span className={theme === 'dark' ? 'text-white' : 'text-[#0D2149]'}>STO</span>
            <span className="text-[#FF5A1F]">Q</span>
            <span className={theme === 'dark' ? 'text-white' : 'text-[#0D2149]'}>O</span>
          </div>
          {showTagline && (
            <span
              className={`text-[9.5px] font-semibold tracking-wide leading-tight mt-0.5 ${
                theme === 'dark' ? 'text-[#FF7A29]' : 'text-[#0D2149]/80'
              }`}
            >
              Smart Stock. Smarter Business.
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full stacked or hero logo for Login, Onboarding, Loading screens
  const iconDimensions = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-16 h-16',
    xl: 'w-20 h-20',
  };

  const wordmarkSizes = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-4xl',
    xl: 'text-5xl',
  };

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <StoqoIcon className={iconDimensions[size]} />
      <div className={`mt-2.5 font-black tracking-tight leading-none ${wordmarkSizes[size]}`}>
        <span className={theme === 'dark' ? 'text-white' : 'text-[#0D2149]'}>STO</span>
        <span className="text-[#FF5A1F]">Q</span>
        <span className={theme === 'dark' ? 'text-white' : 'text-[#0D2149]'}>O</span>
      </div>
      {showTagline && (
        <p
          className={`mt-1.5 text-xs sm:text-sm font-bold tracking-wider uppercase ${
            theme === 'dark' ? 'text-[#FF7A29]' : 'text-[#FF5A1F]'
          }`}
        >
          Smart Stock. Smarter Business.
        </p>
      )}
    </div>
  );
};
