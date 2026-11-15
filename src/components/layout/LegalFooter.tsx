import React from 'react';
import { StoqoLogo } from '../brand/StoqoLogo';

export const OFFICIAL_STOQO_WEBSITE_URL = 'https://stoqo.qjass.in/';

export function navigateToRoute(path: string) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

interface LegalFooterProps {
  variant?: 'full' | 'compact';
}

export const LegalFooter: React.FC<LegalFooterProps> = ({ variant = 'full' }) => {
  const currentPath =
    typeof window !== 'undefined' ? window.location.pathname.toLowerCase().replace(/\/+$/, '') : '';

  if (variant === 'compact') {
    return (
      <footer className="mt-8 border-t border-stone-200/80 pt-4 pb-2 text-xs text-stone-500">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <a
              href={OFFICIAL_STOQO_WEBSITE_URL}
              onClick={(e) => {
                e.preventDefault();
                navigateToRoute('/');
              }}
              className="font-semibold text-[#0D2149] hover:text-[#FF5A1F] transition-colors"
            >
              STOQO
            </a>
            <span aria-hidden="true">·</span>
            <span>Operated by YADDE TECHNOLOGIES</span>
          </div>
          <nav aria-label="Legal navigation" className="flex flex-wrap items-center gap-4">
            <a
              href="/privacy-policy"
              onClick={(e) => {
                e.preventDefault();
                navigateToRoute('/privacy-policy');
              }}
              className="font-medium text-stone-600 hover:text-[#FF5A1F] hover:underline underline-offset-4 transition-colors"
            >
              Privacy Policy
            </a>
            <span aria-hidden="true" className="text-stone-300">
              ·
            </span>
            <a
              href="/terms-and-conditions"
              onClick={(e) => {
                e.preventDefault();
                navigateToRoute('/terms-and-conditions');
              }}
              className="font-medium text-stone-600 hover:text-[#FF5A1F] hover:underline underline-offset-4 transition-colors"
            >
              Terms &amp; Conditions
            </a>
            <span aria-hidden="true" className="text-stone-300">
              ·
            </span>
            <a
              href="mailto:support@yaddetechnologies.in"
              className="font-medium text-stone-600 hover:text-[#FF5A1F] hover:underline underline-offset-4 transition-colors"
            >
              support@yaddetechnologies.in
            </a>
          </nav>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-[#0D2149] text-white border-t border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {/* Brand Column */}
          <div className="space-y-3">
            <StoqoLogo variant="compact" theme="dark" size="md" showTagline={true} />
            <p className="text-xs text-stone-300 leading-relaxed max-w-xs">
              STOQO – Smart Stock. Smarter Business. Restaurant inventory, purchasing, supplier and store management platform operated by YADDE TECHNOLOGIES.
            </p>
          </div>

          {/* Legal Links Column */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF5A1F]">
              Legal &amp; Compliance
            </h3>
            <ul className="space-y-2 text-xs text-stone-200">
              <li>
                <a
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToRoute('/');
                  }}
                  className="hover:text-[#FF5A1F] transition-colors hover:underline underline-offset-4"
                >
                  Back to Home
                </a>
              </li>
              <li>
                <a
                  href="/privacy-policy"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToRoute('/privacy-policy');
                  }}
                  className={`transition-colors hover:underline underline-offset-4 ${
                    currentPath === '/privacy-policy'
                      ? 'text-[#FF5A1F] font-semibold'
                      : 'hover:text-[#FF5A1F]'
                  }`}
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="/terms-and-conditions"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToRoute('/terms-and-conditions');
                  }}
                  className={`transition-colors hover:underline underline-offset-4 ${
                    currentPath === '/terms-and-conditions'
                      ? 'text-[#FF5A1F] font-semibold'
                      : 'hover:text-[#FF5A1F]'
                  }`}
                >
                  Terms &amp; Conditions
                </a>
              </li>
            </ul>
          </div>

          {/* Support & Contact Column */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#FF5A1F]">
              Contact &amp; Support
            </h3>
            <div className="space-y-1.5 text-xs text-stone-300">
              <p className="font-semibold text-white">YADDE TECHNOLOGIES</p>
              <p>Product: STOQO – Restaurant Inventory &amp; Store Management</p>
              <p>
                Email:{' '}
                <a
                  href="mailto:support@yaddetechnologies.in"
                  className="text-white font-semibold hover:text-[#FF5A1F] underline underline-offset-4 transition-colors"
                >
                  support@yaddetechnologies.in
                </a>
              </p>
              <p>
                Website:{' '}
                <a
                  href={OFFICIAL_STOQO_WEBSITE_URL}
                  className="text-white font-semibold hover:text-[#FF5A1F] underline underline-offset-4 transition-colors"
                >
                  {OFFICIAL_STOQO_WEBSITE_URL}
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/15 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-stone-300">
          <p>
            &copy; {new Date().getFullYear()} YADDE TECHNOLOGIES. All rights reserved.
          </p>
          <p className="font-medium text-white">
            STOQO – Smart Stock. Smarter Business.
          </p>
        </div>
      </div>
    </footer>
  );
};
