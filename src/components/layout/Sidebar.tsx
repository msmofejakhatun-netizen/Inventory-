import React from 'react';
import {
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  FileSpreadsheet,
  ArrowRightLeft,
  AlertTriangle,
  Clock,
  Trash2,
  ClipboardCheck,
  Building2,
  CreditCard,
  PieChart,
  BarChart3,
  Bot,
  BrainCircuit,
  Users,
  Settings,
  ShieldCheck,
  History,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types';

export type NavTab =
  | 'dashboard'
  | 'stock'
  | 'purchases'
  | 'purchase_orders'
  | 'issues'
  | 'emergency_issues'
  | 'smart_preshift'
  | 'wastage'
  | 'physical_audit'
  | 'vendors'
  | 'vendor_payments'
  | 'where_money_went'
  | 'reports'
  | 'ai_assistant'
  | '15day_planner'
  | 'pos_integration'
  | 'staff'
  | 'settings'
  | 'subscription'
  | 'audit_logs';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles?: UserRole[];
  badge?: string;
  isAi?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
}) => {
  const { hasRole, activeRole, activeRestaurant } = useAuth();

  const navSections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', label: 'Boss Dashboard', icon: LayoutDashboard },
        { id: 'stock', label: 'Current Stock', icon: Boxes },
        { id: 'where_money_went', label: 'Where Did My Money Go?', icon: PieChart, allowedRoles: ['OWNER', 'MANAGER'] },
      ],
    },
    {
      title: 'Procurement & Vendors',
      items: [
        { id: 'purchases', label: 'Purchases (Inward)', icon: ShoppingCart, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER'] },
        { id: 'purchase_orders', label: 'Purchase Orders (PO)', icon: FileSpreadsheet, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'vendors', label: 'Vendors Master', icon: Building2, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'vendor_payments', label: 'Vendor Payments', icon: CreditCard, allowedRoles: ['OWNER', 'MANAGER'] },
      ],
    },
    {
      title: 'Kitchen Issues & Wastage',
      items: [
        { id: 'smart_preshift', label: 'Smart Pre-Shift Issue', icon: Clock, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER'] },
        { id: 'issues', label: 'Department Issue', icon: ArrowRightLeft, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER', 'DEPARTMENT_STAFF'] },
        { id: 'emergency_issues', label: 'Emergency Issue', icon: AlertTriangle, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER', 'DEPARTMENT_STAFF'] },
        { id: 'wastage', label: 'Wastage Register', icon: Trash2, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER'] },
        { id: 'physical_audit', label: 'Physical Count / Audit', icon: ClipboardCheck, allowedRoles: ['OWNER', 'MANAGER', 'STOREKEEPER'] },
      ],
    },
    {
      title: 'AI Intelligence',
      items: [
        { id: 'ai_assistant', label: 'AI Store Assistant', icon: Bot, isAi: true },
        { id: '15day_planner', label: '15-Day Purchase Planner', icon: BrainCircuit, isAi: true, allowedRoles: ['OWNER', 'MANAGER'] },
      ],
    },
    {
      title: 'Analytics & Management',
      items: [
        { id: 'reports', label: 'Reports & Exports', icon: BarChart3, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'pos_integration', label: 'POS Integration (Petpooja/eZee)', icon: ArrowRightLeft, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'staff', label: 'Staff & Roles', icon: Users, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'audit_logs', label: 'Audit Trail', icon: History, allowedRoles: ['OWNER', 'MANAGER'] },
        { id: 'subscription', label: 'Subscription (₹99/mo)', icon: ShieldCheck, allowedRoles: ['OWNER'] },
        { id: 'settings', label: 'Settings', icon: Settings, allowedRoles: ['OWNER', 'MANAGER'] },
      ],
    },
  ];

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-stone-900/60 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-stone-900 text-stone-300 flex flex-col border-r border-stone-800 transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center text-stone-950 font-bold shadow-xs">
              RC
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">
                STORE CONTROL
              </h1>
              <p className="text-[10px] text-amber-400 font-medium mt-1">
                Know stock. Control cash.
              </p>
            </div>
          </div>
        </div>

        {/* Tenant Active Badge */}
        {activeRestaurant && (
          <div className="px-4 py-2.5 bg-stone-950/60 border-b border-stone-800/80 flex items-center justify-between">
            <div className="truncate">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block">
                Restaurant
              </span>
              <p className="text-xs font-medium text-stone-200 truncate">
                {activeRestaurant.name}
              </p>
            </div>
            <span className="text-[10px] bg-stone-800 text-amber-300 font-semibold px-2 py-0.5 rounded-full border border-stone-700">
              {activeRole || 'STAFF'}
            </span>
          </div>
        )}

        {/* Nav Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navSections.map((section, idx) => {
            const filteredItems = section.items.filter((item) =>
              item.allowedRoles ? hasRole(item.allowedRoles) : true
            );

            if (filteredItems.length === 0) return null;

            return (
              <div key={idx}>
                <h4 className="px-3 text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  {section.title}
                </h4>
                <div className="space-y-1">
                  {filteredItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentTab === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`nav-${item.id}`}
                        onClick={() => handleSelect(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left ${
                          isActive
                            ? 'bg-amber-500 text-stone-950 font-semibold shadow-xs'
                            : 'text-stone-300 hover:bg-stone-800/70 hover:text-white'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-stone-950' : item.isAi ? 'text-amber-400' : 'text-stone-400'
                          }`}
                        />
                        <span className="truncate flex-1">{item.label}</span>
                        {item.isAi && !isActive && (
                          <span className="flex items-center gap-0.5 text-[9px] bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.2 rounded">
                            <Sparkles className="w-2.5 h-2.5" /> AI
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Subscription trial strip */}
        <div className="p-3 border-t border-stone-800 text-[11px] bg-stone-950/40">
          <div className="flex items-center justify-between text-stone-400">
            <span>₹99/mo Pro SaaS</span>
            <span className="text-emerald-400 font-medium">14-Day Trial</span>
          </div>
        </div>
      </aside>
    </>
  );
};
