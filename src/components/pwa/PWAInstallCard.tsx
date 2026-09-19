import React, { useState } from 'react';
import { Smartphone, Monitor, CheckCircle2, Download, ExternalLink, ShieldCheck, Wifi } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { IOSInstallModal } from './IOSInstallModal';

export const PWAInstallCard: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [installing, setInstalling] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-stone-100">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-stone-600" />
          <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
            Progressive Web App (PWA) & Device Installation
          </h2>
        </div>
        {isInstalled ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" /> Installed (Standalone)
          </span>
        ) : isInstallable ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
            Install Available
          </span>
        ) : null}
      </div>

      <div className="space-y-3 text-xs text-stone-600">
        <p>
          Install <strong>Restaurant Store Control System</strong> directly on your Android phone, tablet,
          Windows PC, or macOS device for standalone execution without a browser address bar.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/80 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-stone-900">
              <Monitor className="w-3.5 h-3.5 text-amber-600" />
              <span>Desktop Experience</span>
            </div>
            <p className="text-[11px] text-stone-500">
              Runs in its own dedicated window on Chrome, Edge, and macOS with taskbar/dock launching.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/80 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-stone-900">
              <Smartphone className="w-3.5 h-3.5 text-amber-600" />
              <span>Mobile Experience</span>
            </div>
            <p className="text-[11px] text-stone-500">
              Opens full-screen from your phone's home screen with instant store switching and fast access.
            </p>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100">
          <div className="flex items-center gap-2 text-[11px] text-stone-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Secure HTTPS & Isolated Tenant RBAC</span>
          </div>

          {isInstalled ? (
            <div className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>App is currently running in Standalone PWA Mode</span>
            </div>
          ) : isInstallable ? (
            <button
              id="settings-install-pwa-btn"
              type="button"
              disabled={installing}
              onClick={async () => {
                setInstalling(true);
                try {
                  await install();
                } finally {
                  setInstalling(false);
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs shadow-2xs transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App on this Device</span>
            </button>
          ) : isIOS ? (
            <>
              <button
                id="settings-ios-install-btn"
                type="button"
                onClick={() => setShowIOSModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs shadow-2xs transition-colors"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>How to Install on iPhone / iPad</span>
              </button>
              <IOSInstallModal isOpen={showIOSModal} onClose={() => setShowIOSModal(false)} />
            </>
          ) : (
            <span className="text-[11px] text-stone-400 italic">
              Use Chrome, Edge, or mobile Safari to install directly to home screen/desktop.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
