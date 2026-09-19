import React, { useState } from 'react';
import {
  Menu,
  Bell,
  ChevronDown,
  Building,
  LogOut,
  User,
  Shield,
  Wifi,
  WifiOff,
  Store,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { NotificationDrawer } from './NotificationDrawer';
import { PWAInstallMenuItem } from '../pwa/PWAInstallMenuItem';

interface HeaderProps {
  onToggleMobileMenu: () => void;
  onOpenNewRestaurantModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleMobileMenu,
  onOpenNewRestaurantModal,
}) => {
  const {
    user,
    userProfile,
    activeRestaurant,
    userRestaurants,
    switchRestaurant,
    activeRole,
    logout,
    isFirebaseOffline,
  } = useAuth();

  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  return (
    <>
      <header className="sticky top-0 z-30 h-16 bg-white border-b border-stone-200 flex items-center justify-between px-4 sm:px-6">
        {/* Left: Mobile toggle + Store Switcher */}
        <div className="flex items-center gap-3">
          <button
            id="mobile-menu-toggle-btn"
            onClick={onToggleMobileMenu}
            className="lg:hidden p-2 rounded-lg text-stone-600 hover:bg-stone-100"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Restaurant Switcher */}
          <div className="relative">
            <button
              id="restaurant-switcher-btn"
              onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 hover:border-stone-300 bg-stone-50/60 hover:bg-stone-100 transition-colors"
            >
              <Store className="w-4 h-4 text-amber-600 shrink-0" />
              <div className="text-left">
                <span className="text-xs font-semibold text-stone-900 block truncate max-w-[140px] sm:max-w-[200px]">
                  {activeRestaurant ? activeRestaurant.name : 'Select Restaurant'}
                </span>
                <span className="text-[10px] text-stone-500 block leading-none">
                  {activeRestaurant ? `${activeRestaurant.currency} • ${activeRestaurant.taxSystem}` : ''}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0 ml-1" />
            </button>

            {/* Dropdown */}
            {isStoreMenuOpen && (
              <div
                className="absolute left-0 mt-1.5 w-64 bg-white rounded-xl shadow-lg border border-stone-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                onClick={() => setIsStoreMenuOpen(false)}
              >
                <div className="px-3 py-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                  Your Restaurants ({userRestaurants.length})
                </div>
                {userRestaurants.map((rest) => (
                  <button
                    key={rest.id}
                    id={`switch-rest-${rest.id}`}
                    onClick={() => switchRestaurant(rest.id)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-stone-50 ${
                      activeRestaurant?.id === rest.id
                        ? 'font-bold text-amber-700 bg-amber-50/50'
                        : 'text-stone-700'
                    }`}
                  >
                    <span className="truncate">{rest.name}</span>
                    <span className="text-[10px] text-stone-400 font-normal">{rest.currency}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-stone-100" />
                <button
                  id="add-outlet-btn"
                  onClick={onOpenNewRestaurantModal}
                  className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-amber-50 flex items-center gap-2 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create / Add New Outlet</span>
                </button>
              </div>
            )}
          </div>

          {/* Offline indicator */}
          {isFirebaseOffline && (
            <span className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-xs">
              <WifiOff className="w-3.5 h-3.5" /> Offline Mode
            </span>
          )}
        </div>

        {/* Right: Notifications, User Profile & Role */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Notifications button */}
          <button
            id="notifications-btn"
            onClick={() => setIsNotifDrawerOpen(true)}
            className="relative p-2 rounded-lg text-stone-600 hover:bg-stone-100 transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-amber-500 text-stone-950 font-extrabold text-[10px] rounded-full flex items-center justify-center border-2 border-white">
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>

          <div className="h-6 w-[1px] bg-stone-200 hidden sm:block" />

          {/* User & Role */}
          <div className="relative">
            <button
              id="user-profile-menu-btn"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
            >
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={userProfile?.name || 'User'}
                  className="w-7 h-7 rounded-full object-cover border border-stone-200"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-800 font-semibold text-xs flex items-center justify-center">
                  {(userProfile?.name || user?.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="text-left hidden md:block">
                <p className="text-xs font-semibold text-stone-900 leading-tight truncate max-w-[120px]">
                  {userProfile?.name || user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-[10px] text-amber-700 font-medium leading-none mt-0.5">
                  {activeRole || 'STAFF'}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            </button>

            {isUserMenuOpen && (
              <div
                className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl shadow-lg border border-stone-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                onClick={() => setIsUserMenuOpen(false)}
              >
                <div className="px-3 py-2 border-b border-stone-100">
                  <p className="text-xs font-bold text-stone-900 truncate">{userProfile?.name}</p>
                  <p className="text-[11px] text-stone-500 truncate">{user?.email || user?.phoneNumber}</p>
                  <span className="inline-block mt-1 text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                    Role: {activeRole || 'STAFF'}
                  </span>
                </div>
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[11px] text-stone-500 flex items-center justify-between">
                    <span>Status</span>
                    <span className="text-emerald-600 font-medium">Active Account</span>
                  </div>
                  <PWAInstallMenuItem onActionComplete={() => setIsUserMenuOpen(false)} />
                </div>
                <div className="border-t border-stone-100 my-1" />
                <button
                  id="header-logout-btn"
                  onClick={logout}
                  className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Notification Drawer */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotifCount}
      />
    </>
  );
};
