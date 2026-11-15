import React, { useEffect } from 'react';
import { ArrowLeft, FileText, Mail, Globe, Building2, List } from 'lucide-react';
import { StoqoLogo } from '../components/brand/StoqoLogo';
import {
  LegalFooter,
  navigateToRoute,
  OFFICIAL_STOQO_WEBSITE_URL,
} from '../components/layout/LegalFooter';

interface TermsAndConditionsViewProps {
  onBack?: () => void;
}

const TERMS_TOC = [
  { id: 'terms-1', label: '1. Acceptance of Terms' },
  { id: 'terms-2', label: '2. Description of Services' },
  { id: 'terms-3', label: '3. Account Registration' },
  { id: 'terms-4', label: '4. Restaurant Accounts and Team Permissions' },
  { id: 'terms-5', label: '5. Accuracy of Business Records' },
  { id: 'terms-6', label: '6. Subscription and Fees' },
  { id: 'terms-7', label: '7. Cancellation and Refunds' },
  { id: 'terms-8', label: '8. WhatsApp Business Integration' },
  { id: 'terms-9', label: '9. Acceptable Use' },
  { id: 'terms-10', label: '10. Data and Privacy' },
  { id: 'terms-11', label: '11. Service Availability' },
  { id: 'terms-12', label: '12. Intellectual Property' },
  { id: 'terms-13', label: '13. Third-Party Services' },
  { id: 'terms-14', label: '14. Account Suspension and Termination' },
  { id: 'terms-15', label: '15. Limitation of Liability' },
  { id: 'terms-16', label: '16. Changes to These Terms' },
  { id: 'terms-17', label: '17. Governing Law' },
  { id: 'terms-18', label: '18. Contact Information' },
];

export const TermsAndConditionsView: React.FC<TermsAndConditionsViewProps> = ({ onBack }) => {
  const officialWebsiteUrl = OFFICIAL_STOQO_WEBSITE_URL;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Terms & Conditions – STOQO';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleBackHome = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onBack) {
      onBack();
      return;
    }
    navigateToRoute('/');
  };

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.history.replaceState(null, '', `/terms-and-conditions#${id}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 font-sans">
      {/* Sticky Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <a
            href="/"
            onClick={handleBackHome}
            className="focus:outline-none"
            aria-label="STOQO Home"
          >
            <StoqoLogo variant="compact" theme="light" size="md" showTagline={true} />
          </a>

          <div className="flex items-center gap-4">
            <a
              href="/privacy-policy"
              onClick={(e) => {
                e.preventDefault();
                navigateToRoute('/privacy-policy');
              }}
              className="hidden sm:inline-block text-xs font-semibold text-stone-600 hover:text-[#0D2149] hover:underline underline-offset-4 transition-colors"
            >
              Privacy Policy
            </a>
            <a
              href="/"
              onClick={handleBackHome}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D2149] hover:bg-[#143068] text-white text-xs font-semibold transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Home
            </a>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="bg-[#0D2149] text-white border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#FF5A1F] mb-2">
            <FileText className="w-4 h-4" />
            <span>STOQO – Smart Stock. Smarter Business.</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Terms &amp; Conditions
          </h1>
          <p className="mt-2 text-sm sm:text-base text-stone-300 max-w-2xl">
            Service agreement governing registration, restaurant inventory operations, subscriptions, WhatsApp Business integration, and platform usage.
          </p>

          <div className="mt-6 pt-5 border-t border-white/15 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs sm:text-sm text-stone-300">
            <div>
              <span className="text-stone-400">Effective Date:</span>{' '}
              <strong className="text-white">15 November 2026</strong>
            </div>
            <span aria-hidden="true" className="hidden sm:inline text-white/30">
              ·
            </span>
            <div>
              <span className="text-stone-400">Last Updated:</span>{' '}
              <strong className="text-white">15 November 2026</strong>
            </div>
            <span aria-hidden="true" className="hidden sm:inline text-white/30">
              ·
            </span>
            <div>
              <span className="text-stone-400">Operated By:</span>{' '}
              <strong className="text-white">YADDE TECHNOLOGIES</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Layout with Table of Contents */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Table of Contents (Mobile & Desktop Sticky Sidebar) */}
          <aside
            aria-label="Table of Contents"
            className="lg:col-span-4 lg:sticky lg:top-24 bg-white border border-stone-200 rounded-xl p-5 shadow-2xs"
          >
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-stone-200">
              <List className="w-4 h-4 text-[#FF5A1F]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#0D2149]">
                Table of Contents
              </h2>
            </div>
            <nav>
              <ol className="space-y-1.5 text-xs sm:text-[13px]">
                {TERMS_TOC.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => scrollToSection(e, item.id)}
                      className="block py-1 px-2 rounded-md text-stone-600 hover:text-[#0D2149] hover:bg-stone-100 font-medium transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-5 pt-4 border-t border-stone-200 text-xs text-stone-600 space-y-1.5">
              <p className="font-semibold text-[#0D2149]">Questions About Terms?</p>
              <a
                href="mailto:support@yaddetechnologies.in"
                className="inline-flex items-center gap-1.5 text-[#FF5A1F] font-semibold hover:underline"
              >
                <Mail className="w-3.5 h-3.5" />
                support@yaddetechnologies.in
              </a>
            </div>
          </aside>

          {/* Terms Document Body */}
          <article className="lg:col-span-8 bg-white border border-stone-200 rounded-xl shadow-2xs p-6 sm:p-10 space-y-10 text-sm sm:text-[15px] text-stone-700 leading-relaxed">
            {/* 1. Acceptance of Terms */}
            <section id="terms-1" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                1. Acceptance of Terms
              </h2>
              <p>
                Welcome to STOQO, a restaurant inventory and store management platform operated by{' '}
                <strong>YADDE TECHNOLOGIES</strong>.
              </p>
              <p>
                By registering, accessing or using STOQO, you agree to these Terms &amp; Conditions. If you do not agree, you should not use the service.
              </p>
            </section>

            {/* 2. Description of Services */}
            <section id="terms-2" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                2. Description of Services
              </h2>
              <p>
                STOQO provides software tools for restaurant and food-service businesses, including:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Inventory and stock management.</li>
                <li>Item and category management.</li>
                <li>Supplier and vendor management.</li>
                <li>Purchase order creation and management.</li>
                <li>Goods receiving and stock inward.</li>
                <li>Stock adjustments and wastage tracking.</li>
                <li>Vendor transaction records.</li>
                <li>Team member and role management.</li>
                <li>Business reports and analytics.</li>
                <li>WhatsApp Business integration, where available.</li>
                <li>Subscription-based access to platform features.</li>
              </ul>
              <p>
                Features may change, improve or become unavailable as the platform develops.
              </p>
            </section>

            {/* 3. Account Registration */}
            <section id="terms-3" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                3. Account Registration
              </h2>
              <p>
                Users must provide accurate and up-to-date registration information.
              </p>
              <p>You are responsible for:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Keeping your login credentials confidential.</li>
                <li>Protecting access to your account.</li>
                <li>Ensuring that team members use their own authorised accounts.</li>
                <li>Notifying us if you suspect unauthorised account access.</li>
                <li>Maintaining accurate restaurant and business details.</li>
              </ul>
              <p>
                You must not impersonate another person or create accounts using information you are not authorised to use.
              </p>
            </section>

            {/* 4. Restaurant Accounts and Team Permissions */}
            <section id="terms-4" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                4. Restaurant Accounts and Team Permissions
              </h2>
              <p>
                The restaurant account owner is responsible for managing team members and assigning appropriate roles.
              </p>
              <p>Users must not:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Access another restaurant&apos;s data without authorisation.</li>
                <li>Bypass role-based permissions.</li>
                <li>Attempt to gain administrator privileges without approval.</li>
                <li>Share accounts or credentials in an unauthorised manner.</li>
                <li>Misuse another user&apos;s information.</li>
              </ul>
              <p>
                Each user must operate within the permissions assigned to their account.
              </p>
            </section>

            {/* 5. Accuracy of Business Records */}
            <section id="terms-5" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                5. Accuracy of Business Records
              </h2>
              <p>
                STOQO provides tools for recording and managing business information. The restaurant is responsible for verifying the accuracy of:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Inventory quantities.</li>
                <li>Purchase rates and invoices.</li>
                <li>Supplier information.</li>
                <li>Purchase orders.</li>
                <li>Received quantities.</li>
                <li>Vendor payments.</li>
                <li>Wastage and stock adjustments.</li>
                <li>Other business records entered into the platform.</li>
              </ul>
              <p>
                STOQO should not be treated as a substitute for physical stock verification, accounting review or professional financial advice.
              </p>
            </section>

            {/* 6. Subscription and Fees */}
            <section id="terms-6" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                6. Subscription and Fees
              </h2>
              <p>STOQO offers paid subscription plans.</p>
              <p>
                The current standard monthly subscription price is{' '}
                <strong>₹799 per month</strong>, unless a different price or promotional offer is clearly displayed at the time of purchase.
              </p>
              <p>Subscription terms:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Payment must be completed through an available payment method.</li>
                <li>Subscription activation depends on successful payment verification.</li>
                <li>
                  Renewal and billing dates will be displayed or communicated through the applicable payment flow.
                </li>
                <li>Applicable taxes may be charged where required.</li>
                <li>
                  Failed, pending or disputed payments may affect subscription access.
                </li>
                <li>
                  Any material pricing or subscription changes will be communicated appropriately.
                </li>
              </ul>
              <p>
                Payment processing may be handled by Razorpay or another authorised payment provider. Payment providers may apply their own terms.
              </p>
            </section>

            {/* 7. Cancellation and Refunds */}
            <section id="terms-7" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                7. Cancellation and Refunds
              </h2>
              <p>
                Users may request subscription cancellation through the available account or support process.
              </p>
              <p>
                Cancellation prevents future renewals where successfully processed, but does not automatically reverse a payment already completed.
              </p>
              <p>
                Refund requests will be reviewed according to the applicable refund policy, payment status and legal requirements.
              </p>
              <p>
                Where a payment has been deducted but subscription activation has failed, users should contact support with the transaction reference.
              </p>
            </section>

            {/* 8. WhatsApp Business Integration */}
            <section id="terms-8" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                8. WhatsApp Business Integration
              </h2>
              <p>
                Where available, STOQO may allow authorised users to connect a WhatsApp Business account and send operational messages to suppliers.
              </p>
              <p>Users are responsible for:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Connecting an account they are authorised to manage.</li>
                <li>Providing correct supplier contact information.</li>
                <li>Obtaining necessary permissions to contact suppliers.</li>
                <li>Complying with Meta and WhatsApp policies.</li>
                <li>Using approved message templates where required.</li>
                <li>Avoiding spam, harassment or unlawful messaging.</li>
              </ul>
              <p>
                WhatsApp delivery depends on Meta&apos;s systems, account eligibility, permissions, network availability and applicable messaging rules.
              </p>
              <p>STOQO does not guarantee uninterrupted WhatsApp delivery.</p>
            </section>

            {/* 9. Acceptable Use */}
            <section id="terms-9" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                9. Acceptable Use
              </h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Use STOQO for unlawful activities.</li>
                <li>Upload malicious files or harmful code.</li>
                <li>Attempt to compromise platform security.</li>
                <li>Reverse engineer or disrupt the service unlawfully.</li>
                <li>Access data belonging to other restaurants.</li>
                <li>Use the platform to send spam or fraudulent communications.</li>
                <li>Misrepresent your identity or business.</li>
                <li>Interfere with other users&apos; access to the platform.</li>
              </ul>
              <p>
                We may restrict or suspend access when reasonably necessary to investigate suspected misuse, protect users or comply with law.
              </p>
            </section>

            {/* 10. Data and Privacy */}
            <section id="terms-10" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                10. Data and Privacy
              </h2>
              <p>
                Your use of STOQO is also governed by our{' '}
                <a
                  href="/privacy-policy"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToRoute('/privacy-policy');
                  }}
                  className="font-semibold text-[#FF5A1F] hover:underline underline-offset-4"
                >
                  Privacy Policy
                </a>
                .
              </p>
              <p>
                You retain responsibility for the business information and records you enter into the platform. You grant STOQO permission to process that information only as reasonably necessary to provide, secure and support the services, subject to the Privacy Policy and applicable law.
              </p>
            </section>

            {/* 11. Service Availability */}
            <section id="terms-11" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                11. Service Availability
              </h2>
              <p>
                We aim to keep STOQO available and reliable. However, uninterrupted service cannot be guaranteed.
              </p>
              <p>Temporary interruptions may occur due to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Maintenance and upgrades.</li>
                <li>Hosting or infrastructure failures.</li>
                <li>Internet or network issues.</li>
                <li>Third-party service outages.</li>
                <li>Security incidents.</li>
                <li>Events outside our reasonable control.</li>
              </ul>
              <p>
                We will take reasonable steps to restore service when interruptions occur.
              </p>
            </section>

            {/* 12. Intellectual Property */}
            <section id="terms-12" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                12. Intellectual Property
              </h2>
              <p>
                STOQO&apos;s name, logo, branding, interface, software, design and original platform materials are owned by or licensed to{' '}
                <strong>YADDE TECHNOLOGIES</strong>, unless otherwise stated.
              </p>
              <p>
                Users may not copy, resell, distribute or commercially exploit STOQO&apos;s intellectual property without written permission.
              </p>
            </section>

            {/* 13. Third-Party Services */}
            <section id="terms-13" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                13. Third-Party Services
              </h2>
              <p>
                STOQO may rely on third-party providers for authentication, hosting, payment processing, messaging and other integrations.
              </p>
              <p>
                Third-party services are subject to their own terms, policies and availability. We are not responsible for independent failures or changes made by those providers, except to the extent required by applicable law.
              </p>
            </section>

            {/* 14. Account Suspension and Termination */}
            <section id="terms-14" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                14. Account Suspension and Termination
              </h2>
              <p>We may suspend or terminate an account where:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>These Terms are materially violated.</li>
                <li>The account is used for unlawful or fraudulent activity.</li>
                <li>Security or platform integrity is at risk.</li>
                <li>Required payments remain unpaid.</li>
                <li>Suspension is required by law or a valid legal request.</li>
              </ul>
              <p>
                Where reasonably possible and legally permitted, we will provide notice and an opportunity to resolve the issue.
              </p>
              <p>
                Users may request account closure through the available support process. Data handling after closure is governed by the Privacy Policy and applicable law.
              </p>
            </section>

            {/* 15. Limitation of Liability */}
            <section id="terms-15" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                15. Limitation of Liability
              </h2>
              <p>
                STOQO is a software tool intended to assist business operations. Users remain responsible for business decisions, physical stock verification, purchasing decisions, supplier payments and accounting records.
              </p>
              <p>
                To the extent permitted by applicable law, <strong>YADDE TECHNOLOGIES</strong> will not be liable for indirect or consequential losses arising from use or temporary unavailability of the platform.
              </p>
              <p>
                Nothing in these Terms excludes liability that cannot legally be excluded under applicable law.
              </p>
            </section>

            {/* 16. Changes to These Terms */}
            <section id="terms-16" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                16. Changes to These Terms
              </h2>
              <p>
                We may update these Terms when our services or legal requirements change.
              </p>
              <p>
                Updated Terms will be published on the STOQO website with a revised date. Continued use after an update constitutes acceptance where permitted by law.
              </p>
            </section>

            {/* 17. Governing Law */}
            <section id="terms-17" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                17. Governing Law
              </h2>
              <p>These Terms are governed by the laws of India.</p>
              <p>
                Any disputes will be handled by the competent courts having jurisdiction under applicable Indian law.
              </p>
            </section>

            {/* 18. Contact Information */}
            <section id="terms-18" className="scroll-mt-24 space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                18. Contact Information
              </h2>

              <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-[#0D2149]">
                  <Building2 className="w-4 h-4 text-[#FF5A1F]" />
                  <span>YADDE TECHNOLOGIES</span>
                </div>
                <p className="text-stone-700 font-medium">
                  Product: STOQO – Restaurant Inventory &amp; Store Management
                </p>
                <div className="flex items-center gap-2 text-stone-700">
                  <Mail className="w-4 h-4 text-[#FF5A1F] shrink-0" />
                  <span>
                    Email:{' '}
                    <a
                      href="mailto:support@yaddetechnologies.in"
                      className="font-semibold text-[#0D2149] hover:text-[#FF5A1F] underline underline-offset-4 transition-colors"
                    >
                      support@yaddetechnologies.in
                    </a>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-stone-700 break-all">
                  <Globe className="w-4 h-4 text-[#FF5A1F] shrink-0" />
                  <span>
                    Website:{' '}
                    <a
                      href={officialWebsiteUrl}
                      className="font-semibold text-[#0D2149] hover:text-[#FF5A1F] underline underline-offset-4 transition-colors"
                    >
                      {officialWebsiteUrl}
                    </a>
                  </span>
                </div>
              </div>
            </section>

            {/* Document Sign-off */}
            <div className="pt-6 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-stone-500">
              <div>
                <p className="font-bold text-[#0D2149]">
                  STOQO – Smart Stock. Smarter Business.
                </p>
                <p>Operated by YADDE TECHNOLOGIES.</p>
              </div>
              <a
                href="/privacy-policy"
                onClick={(e) => {
                  e.preventDefault();
                  navigateToRoute('/privacy-policy');
                }}
                className="font-semibold text-[#FF5A1F] hover:underline underline-offset-4"
              >
                Read Privacy Policy →
              </a>
            </div>
          </article>
        </div>
      </main>

      {/* Consistent STOQO Footer */}
      <LegalFooter variant="full" />
    </div>
  );
};
