/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthView } from './views/AuthView';
import { OnboardingView } from './views/OnboardingView';
import { Sidebar, NavTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { NotificationDrawer } from './components/layout/NotificationDrawer';
import { DashboardView } from './views/DashboardView';
import { StockView } from './views/StockView';
import { WhereDidMoneyGoView } from './views/WhereDidMoneyGoView';
import { PurchasesView } from './views/PurchasesView';
import { PurchaseOrdersView } from './views/PurchaseOrdersView';
import { IssuesView } from './views/IssuesView';
import { EmergencyIssuesView } from './views/EmergencyIssuesView';
import { SmartPreShiftView } from './views/SmartPreShiftView';
import { FifteenDayPlannerView } from './views/FifteenDayPlannerView';
import { VendorsView } from './views/VendorsView';
import { WastageView } from './views/WastageView';
import { PhysicalAuditView } from './views/PhysicalAuditView';
import { ReportsView } from './views/ReportsView';
import { POSIntegrationView } from './views/POSIntegrationView';
import { AIAssistantView } from './views/AIAssistantView';
import { SubscriptionView } from './views/SubscriptionView';
import { AuditLogsView } from './views/AuditLogsView';
import { SettingsView } from './views/SettingsView';
import { PrivacyPolicyView } from './views/PrivacyPolicyView';
import { TermsAndConditionsView } from './views/TermsAndConditionsView';
import { LegalFooter } from './components/layout/LegalFooter';
import { LoadingScreen } from './components/loading/LoadingScreen';
import { OfflineBanner } from './components/pwa/OfflineBanner';

function getPublicLegalRoute(): 'privacy' | 'terms' | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  if (path === '/privacy-policy') {
    return 'privacy';
  }
  if (path === '/terms-and-conditions') {
    return 'terms';
  }
  return null;
}

const ACTIVE_TAB_STORAGE_KEY = 'stoqo_active_tab_v1';
const ALLOWED_NAV_TABS: ReadonlySet<NavTab> = new Set<NavTab>([
  'dashboard',
  'stock',
  'where_money_went',
  'purchases',
  'purchase_orders',
  'issues',
  'emergency_issues',
  'smart_preshift',
  '15day_planner',
  'vendors',
  'vendor_payments',
  'wastage',
  'physical_audit',
  'reports',
  'pos_integration',
  'ai_assistant',
  'subscription',
  'audit_logs',
  'staff',
  'settings',
]);

function readInitialActiveTab(): NavTab {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return 'dashboard';
  }
  try {
    const saved = window.sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) as NavTab | null;
    if (saved && ALLOWED_NAV_TABS.has(saved)) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'dashboard';
}

const AppContent: React.FC = () => {
  const {
    user,
    loading,
    loadingStage,
    loadingProgress,
    error,
    isFirebaseOffline,
    retryInitialization,
    userRestaurants,
    activeRestaurant,
  } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>(readInitialActiveTab);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotifsOpen, setIsNotifsOpen] = useState(false);
  const [isTransitionDone, setIsTransitionDone] = useState(false);
  const [publicLegalRoute, setPublicLegalRoute] = useState<'privacy' | 'terms' | null>(
    getPublicLegalRoute
  );

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore storage errors
    }
  }, [activeTab]);

  React.useEffect(() => {
    const syncRoute = () => setPublicLegalRoute(getPublicLegalRoute());
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Dedicated standalone legal routes (publicly accessible without login)
  if (publicLegalRoute === 'privacy') {
    return (
      <PrivacyPolicyView
        onBack={() => {
          window.history.pushState({}, '', '/');
          setPublicLegalRoute(null);
        }}
      />
    );
  }

  if (publicLegalRoute === 'terms') {
    return (
      <TermsAndConditionsView
        onBack={() => {
          window.history.pushState({}, '', '/');
          setPublicLegalRoute(null);
        }}
      />
    );
  }

  // Premium SaaS Loading Screen with real Firebase/Auth state
  if (!isTransitionDone) {
    return (
      <LoadingScreen
        isReady={!loading && !error && !isFirebaseOffline}
        stage={loadingStage}
        progress={loadingProgress}
        error={error || (isFirebaseOffline ? 'Firebase client is offline' : null)}
        onRetry={retryInitialization}
        onComplete={() => setIsTransitionDone(true)}
      />
    );
  }

  // Not signed in
  if (!user) {
    return (
      <>
        <OfflineBanner />
        <AuthView />
      </>
    );
  }

  // Signed in, but no restaurant created yet -> Onboarding
  const hasRestaurants = (userRestaurants?.length ?? 0) > 0;
  if (!hasRestaurants || !activeRestaurant) {
    return (
      <>
        <OfflineBanner />
        <OnboardingView />
      </>
    );
  }

  // Main SaaS layout
  return (
    <div className="flex h-screen bg-stone-100/70 text-stone-900 overflow-hidden font-sans">
      <OfflineBanner />
      {/* Sidebar navigation */}
      <Sidebar
        currentTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setIsMobileMenuOpen(false);
        }}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
          onOpenNewRestaurantModal={() => {}}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto pb-12">
            {activeTab === 'dashboard' && <DashboardView onNavigate={setActiveTab} />}
            {activeTab === 'stock' && <StockView />}
            {activeTab === 'where_money_went' && <WhereDidMoneyGoView />}
            {activeTab === 'purchases' && <PurchasesView />}
            {activeTab === 'purchase_orders' && <PurchaseOrdersView />}
            {activeTab === 'issues' && <IssuesView />}
            {activeTab === 'emergency_issues' && <EmergencyIssuesView />}
            {activeTab === 'smart_preshift' && <SmartPreShiftView />}
            {activeTab === '15day_planner' && <FifteenDayPlannerView />}
            {activeTab === 'vendors' && <VendorsView />}
            {activeTab === 'vendor_payments' && <VendorsView />}
            {activeTab === 'wastage' && <WastageView />}
            {activeTab === 'physical_audit' && <PhysicalAuditView />}
            {activeTab === 'reports' && <ReportsView />}
            {activeTab === 'pos_integration' && <POSIntegrationView />}
            {activeTab === 'ai_assistant' && <AIAssistantView />}
            {activeTab === 'subscription' && <SubscriptionView />}
            {activeTab === 'audit_logs' && <AuditLogsView />}
            {activeTab === 'staff' && <SettingsView />}
            {activeTab === 'settings' && <SettingsView />}

            <LegalFooter variant="compact" />
          </div>
        </main>
      </div>

      {/* Real-Time Price Hike & Notification Drawer */}
      <NotificationDrawer isOpen={isNotifsOpen} onClose={() => setIsNotifsOpen(false)} />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
