import React, { useEffect } from 'react';
import { ArrowLeft, Shield, Mail, Globe, Building2, List } from 'lucide-react';
import { StoqoLogo } from '../components/brand/StoqoLogo';
import {
  LegalFooter,
  navigateToRoute,
  OFFICIAL_STOQO_WEBSITE_URL,
} from '../components/layout/LegalFooter';

interface PrivacyPolicyViewProps {
  onBack?: () => void;
}

const PRIVACY_TOC = [
  { id: 'privacy-1', label: '1. Introduction' },
  { id: 'privacy-2', label: '2. Information We Collect' },
  { id: 'privacy-3', label: '3. How We Use Your Information' },
  { id: 'privacy-4', label: '4. WhatsApp Integration' },
  { id: 'privacy-5', label: '5. How We Share Information' },
  { id: 'privacy-6', label: '6. Restaurant Data and Responsibilities' },
  { id: 'privacy-7', label: '7. Data Storage and Security' },
  { id: 'privacy-8', label: '8. Data Retention' },
  { id: 'privacy-9', label: '9. Your Privacy Rights' },
  { id: 'privacy-10', label: '10. Cookies and Similar Technologies' },
  { id: 'privacy-11', label: '11. Third-Party Services and Links' },
  { id: 'privacy-12', label: "12. Children's Privacy" },
  { id: 'privacy-13', label: '13. Changes to This Privacy Policy' },
  { id: 'privacy-14', label: '14. Contact and Grievance Requests' },
];

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => {
  const officialWebsiteUrl = OFFICIAL_STOQO_WEBSITE_URL;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Privacy Policy – STOQO';
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
      window.history.replaceState(null, '', `/privacy-policy#${id}`);
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
              href="/terms-and-conditions"
              onClick={(e) => {
                e.preventDefault();
                navigateToRoute('/terms-and-conditions');
              }}
              className="hidden sm:inline-block text-xs font-semibold text-stone-600 hover:text-[#0D2149] hover:underline underline-offset-4 transition-colors"
            >
              Terms &amp; Conditions
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
            <Shield className="w-4 h-4" />
            <span>STOQO – Smart Stock. Smarter Business.</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm sm:text-base text-stone-300 max-w-2xl">
            How YADDE TECHNOLOGIES collects, uses, protects, and manages personal and restaurant business information across STOQO.
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
                {PRIVACY_TOC.map((item) => (
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
              <p className="font-semibold text-[#0D2149]">Need Privacy Assistance?</p>
              <a
                href="mailto:support@yaddetechnologies.in"
                className="inline-flex items-center gap-1.5 text-[#FF5A1F] font-semibold hover:underline"
              >
                <Mail className="w-3.5 h-3.5" />
                support@yaddetechnologies.in
              </a>
            </div>
          </aside>

          {/* Policy Document Body */}
          <article className="lg:col-span-8 bg-white border border-stone-200 rounded-xl shadow-2xs p-6 sm:p-10 space-y-10 text-sm sm:text-[15px] text-stone-700 leading-relaxed">
            {/* 1. Introduction */}
            <section id="privacy-1" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                1. Introduction
              </h2>
              <p>
                Welcome to STOQO (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;, or &quot;STOQO&quot;), a restaurant inventory and store management platform operated by <strong>YADDE TECHNOLOGIES</strong>.
              </p>
              <p>
                STOQO provides digital tools that help restaurants manage inventory, stock movements, purchasing, suppliers, purchase orders, goods receiving, wastage, vendor transactions, reports, team members and related business operations.
              </p>
              <p>
                We respect your privacy and are committed to protecting personal and business information processed through our website, applications and services.
              </p>
              <p>
                This Privacy Policy explains what information we collect, why we collect it, how we use it, when we share it and how users can exercise their privacy rights.
              </p>
              <p>
                By using STOQO, you acknowledge that you have read this Privacy Policy.
              </p>
            </section>

            {/* 2. Information We Collect */}
            <section id="privacy-2" className="scroll-mt-24 space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                2. Information We Collect
              </h2>
              <p>
                Depending on how you use STOQO, we may collect the following information:
              </p>

              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <h3 className="font-bold text-[#0D2149] text-base">
                    A. Account and Profile Information
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>Full name</li>
                    <li>Email address</li>
                    <li>Mobile number</li>
                    <li>Login and authentication information</li>
                    <li>Account role and permissions</li>
                    <li>Restaurant or business name</li>
                    <li>Business address and contact details</li>
                  </ul>
                </div>

                <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <h3 className="font-bold text-[#0D2149] text-base">
                    B. Restaurant and Business Information
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>Restaurant profile and branch details</li>
                    <li>Inventory item names and categories</li>
                    <li>Stock quantities and units</li>
                    <li>Purchase and receiving records</li>
                    <li>Supplier and vendor information</li>
                    <li>Purchase orders and invoices</li>
                    <li>Vendor payments and transaction records</li>
                    <li>Wastage and stock adjustment records</li>
                    <li>Reports and business activity logs</li>
                  </ul>
                </div>

                <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <h3 className="font-bold text-[#0D2149] text-base">
                    C. Team Member Information
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>Employee names</li>
                    <li>Email addresses and phone numbers</li>
                    <li>Assigned roles and access permissions</li>
                    <li>Account activity and relevant audit logs</li>
                  </ul>
                </div>

                <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <h3 className="font-bold text-[#0D2149] text-base">
                    D. Payment and Subscription Information
                  </h3>
                  <p className="text-stone-600">
                    STOQO may collect subscription-related information, including:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>Subscription plan</li>
                    <li>Payment status</li>
                    <li>Transaction reference and order ID</li>
                    <li>Billing history</li>
                    <li>Subscription start and renewal dates</li>
                  </ul>
                  <p className="text-stone-600 pt-1">
                    Payments may be processed by third-party payment providers such as Razorpay. STOQO does not intend to store complete card numbers, CVV numbers or UPI PINs on its own servers.
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                  <h3 className="font-bold text-[#0D2149] text-base">
                    E. Technical and Usage Information
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>IP address</li>
                    <li>Browser and device information</li>
                    <li>Operating system</li>
                    <li>Login timestamps</li>
                    <li>App usage and diagnostic information</li>
                    <li>Security and error logs</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 3. How We Use Your Information */}
            <section id="privacy-3" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                3. How We Use Your Information
              </h2>
              <p>We use collected information to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Create and manage user accounts.</li>
                <li>Provide restaurant inventory and stock management services.</li>
                <li>Manage purchasing, suppliers and purchase orders.</li>
                <li>Process goods receiving and stock updates.</li>
                <li>Maintain vendor ledgers and transaction history.</li>
                <li>Generate business reports and analytics.</li>
                <li>Manage team members and access permissions.</li>
                <li>Send important service notifications.</li>
                <li>Process subscriptions and payments.</li>
                <li>Provide customer support.</li>
                <li>Detect fraud, misuse and unauthorised access.</li>
                <li>Maintain platform security and improve STOQO services.</li>
                <li>Comply with applicable legal requirements.</li>
              </ul>
              <p className="font-semibold text-[#0D2149]">
                We do not sell users&apos; personal information as a business model.
              </p>
            </section>

            {/* 4. WhatsApp Integration */}
            <section id="privacy-4" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                4. WhatsApp Integration
              </h2>
              <p>
                STOQO may offer WhatsApp Business integration to help authorised restaurant users communicate purchase orders and related operational messages to their suppliers.
              </p>
              <p>
                When a restaurant connects its WhatsApp Business account, certain information may be processed, including:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>WhatsApp Business account identifiers.</li>
                <li>Phone Number ID and business account identifiers.</li>
                <li>Supplier phone numbers.</li>
                <li>Purchase order details.</li>
                <li>Message delivery and status information.</li>
                <li>Webhook and integration event information.</li>
              </ul>
              <p>
                Messages sent through the purchase order feature may include item names, quantities and units.
              </p>
              <p>
                WhatsApp services are provided through Meta Platforms and are subject to Meta&apos;s own terms and privacy policies.
              </p>
              <p>
                Users are responsible for ensuring that they have the necessary authority and permission to share supplier contact details and send messages to suppliers.
              </p>
              <p>
                STOQO does not use WhatsApp integration to send unrelated promotional messages without an appropriate lawful basis.
              </p>
            </section>

            {/* 5. How We Share Information */}
            <section id="privacy-5" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                5. How We Share Information
              </h2>
              <p>
                We may share limited information with service providers when necessary to operate STOQO.
              </p>
              <p>These providers may include:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong>Firebase / Google:</strong> Authentication, database and application infrastructure, where enabled.
                </li>
                <li>
                  <strong>Cloud hosting providers:</strong> Hosting, server operations and storage.
                </li>
                <li>
                  <strong>Meta / WhatsApp:</strong> WhatsApp Business messaging and integration.
                </li>
                <li>
                  <strong>Razorpay:</strong> Subscription payments and payment verification.
                </li>
                <li>
                  <strong>Technical service providers:</strong> Security, monitoring, diagnostics and support.
                </li>
              </ul>
              <p>We may also disclose information:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>When required by applicable law or a valid legal request.</li>
                <li>To investigate fraud, security incidents or misuse.</li>
                <li>To protect STOQO, our users and other affected parties.</li>
                <li>
                  In connection with a business restructuring, merger or transfer, subject to applicable safeguards.
                </li>
              </ul>
              <p>
                We do not authorise service providers to use personal information for purposes unrelated to the services they provide to us.
              </p>
            </section>

            {/* 6. Restaurant Data and Responsibilities */}
            <section id="privacy-6" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                6. Restaurant Data and Responsibilities
              </h2>
              <p>
                Restaurants using STOQO may upload or enter information about their employees, suppliers and business operations.
              </p>
              <p>
                The restaurant account owner or authorised administrator is responsible for:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Ensuring that they have the authority to enter and use such information.</li>
                <li>
                  Providing appropriate privacy notices to their employees and other relevant individuals.
                </li>
                <li>Maintaining accurate supplier and employee information.</li>
                <li>Managing team access and permissions.</li>
                <li>
                  Removing access when an employee or team member no longer requires it.
                </li>
              </ul>
              <p>
                STOQO processes restaurant operational information to provide the services requested by the restaurant. The restaurant remains responsible for its own business records and the personal information it chooses to upload, subject to applicable law.
              </p>
            </section>

            {/* 7. Data Storage and Security */}
            <section id="privacy-7" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                7. Data Storage and Security
              </h2>
              <p>
                We use reasonable technical and organisational measures designed to protect information against unauthorised access, loss, misuse, alteration or disclosure.
              </p>
              <p>Depending on the service and infrastructure, safeguards may include:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Authentication and access controls.</li>
                <li>Role-based permissions.</li>
                <li>Secure server communication.</li>
                <li>Database security rules.</li>
                <li>Audit logs and activity monitoring.</li>
                <li>Backup and recovery procedures.</li>
                <li>Protection of confidential API credentials.</li>
              </ul>
              <p>
                No online system can be guaranteed to be completely secure. Users should protect their passwords, devices and account credentials.
              </p>
            </section>

            {/* 8. Data Retention */}
            <section id="privacy-8" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                8. Data Retention
              </h2>
              <p>We retain information for as long as reasonably necessary to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Provide STOQO services.</li>
                <li>Maintain restaurant business records.</li>
                <li>Manage subscriptions and billing.</li>
                <li>Resolve disputes and support requests.</li>
                <li>Meet legal, tax, accounting and security obligations.</li>
              </ul>
              <p>
                When information is no longer required, we will take reasonable steps to delete or anonymise it, subject to applicable legal requirements and legitimate retention needs.
              </p>
              <p>
                Some transaction, audit or backup records may remain for a limited period after account closure.
              </p>
            </section>

            {/* 9. Your Privacy Rights */}
            <section id="privacy-9" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                9. Your Privacy Rights
              </h2>
              <p>Subject to applicable law, individuals may have rights to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Request information about personal data processed by us.</li>
                <li>Request correction of inaccurate information.</li>
                <li>Request completion or updating of information.</li>
                <li>Request erasure of personal data where legally applicable.</li>
                <li>Withdraw consent where processing is based on consent.</li>
                <li>Raise a privacy complaint.</li>
                <li>Nominate another individual where provided under applicable law.</li>
              </ul>
              <p>
                To submit a privacy request, contact us using the details in the{' '}
                <a
                  href="#privacy-14"
                  onClick={(e) => scrollToSection(e, 'privacy-14')}
                  className="font-semibold text-[#FF5A1F] hover:underline"
                >
                  Contact section
                </a>
                .
              </p>
              <p>
                We may need to verify your identity and account association before acting on a request.
              </p>
            </section>

            {/* 10. Cookies and Similar Technologies */}
            <section id="privacy-10" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                10. Cookies and Similar Technologies
              </h2>
              <p>
                Our website or application may use cookies, local storage or similar technologies for:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Login sessions.</li>
                <li>Essential application functionality.</li>
                <li>Security.</li>
                <li>User preferences.</li>
                <li>Performance and diagnostics.</li>
              </ul>
              <p>
                You can manage cookies through your browser settings. Disabling essential cookies or storage may affect certain features.
              </p>
            </section>

            {/* 11. Third-Party Services and Links */}
            <section id="privacy-11" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                11. Third-Party Services and Links
              </h2>
              <p>
                STOQO may integrate with or link to third-party services, including Meta, WhatsApp, Google and payment providers.
              </p>
              <p>
                These services operate under their own privacy policies and terms. We are not responsible for the independent privacy practices of third-party services.
              </p>
              <p>We encourage users to review the relevant third-party policies.</p>
            </section>

            {/* 12. Children's Privacy */}
            <section id="privacy-12" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                12. Children&apos;s Privacy
              </h2>
              <p>
                STOQO is a business management platform intended for restaurant owners, authorised employees and business users.
              </p>
              <p>
                It is not designed for children to create independent accounts. We do not knowingly seek to collect children&apos;s personal information for independent account use.
              </p>
            </section>

            {/* 13. Changes to This Privacy Policy */}
            <section id="privacy-13" className="scroll-mt-24 space-y-3">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                13. Changes to This Privacy Policy
              </h2>
              <p>
                We may update this Privacy Policy when our services, technology or legal requirements change.
              </p>
              <p>
                Updated versions will be published on our website with a revised &quot;Last Updated&quot; date. Where required by law, we will provide additional notice or obtain consent.
              </p>
            </section>

            {/* 14. Contact and Grievance Requests */}
            <section id="privacy-14" className="scroll-mt-24 space-y-4">
              <h2 className="text-lg sm:text-xl font-bold text-[#0D2149]">
                14. Contact and Grievance Requests
              </h2>
              <p>
                For privacy questions, data access requests, correction requests, deletion requests or complaints, contact:
              </p>

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

              <p className="text-xs sm:text-sm text-stone-600">
                Please include your registered email address, restaurant name and a description of your request. Do not send passwords, OTPs or payment PINs.
              </p>
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
                href="/terms-and-conditions"
                onClick={(e) => {
                  e.preventDefault();
                  navigateToRoute('/terms-and-conditions');
                }}
                className="font-semibold text-[#FF5A1F] hover:underline underline-offset-4"
              >
                Read Terms &amp; Conditions →
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
