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
import { Boxes } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, loading, userRestaurants, activeRestaurant } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotifsOpen, setIsNotifsOpen] = useState(false);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500 text-stone-950 flex items-center justify-center animate-pulse">
          <Boxes className="w-7 h-7" />
        </div>
        <div className="text-center">
          <h2 className="text-sm font-bold uppercase tracking-wider text-stone-200">
            Restaurant Store Control System
          </h2>
          <p className="text-xs text-stone-500 mt-1">Connecting to Firestore Database...</p>
        </div>
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return <AuthView />;
  }

  // Signed in, but no restaurant created yet -> Onboarding
  const hasRestaurants = (userRestaurants?.length ?? 0) > 0;
  if (!hasRestaurants || !activeRestaurant) {
    return <OnboardingView />;
  }

  // Main SaaS layout
  return (
    <div className="flex h-screen bg-stone-100/70 text-stone-900 overflow-hidden font-sans">
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
