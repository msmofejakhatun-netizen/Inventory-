import React, { useState } from 'react';
import { Download, CheckCircle2, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { IOSInstallModal } from './IOSInstallModal';

interface PWAInstallMenuItemProps {
  onActionComplete?: () => void;
  className?: string;
}

export const PWAInstallMenuItem: React.FC<PWAInstallMenuItemProps> = ({
  onActionComplete,
  className = '',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // If already installed in standalone mode, show clean confirmed status
  if (isInstalled) {
    return (
      <div
        id="pwa-installed-status-indicator"
        className={`px-3 py-1.5 text-[11px] text-emerald-600 font-medium flex items-center gap-1.5 ${className}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>App Installed (Standalone)</span>
      </div>
    );
  }

  // If browser supports installation via beforeinstallprompt
  if (isInstallable) {
    return (
      <button
        id="pwa-install-menu-btn"
        type="button"
        disabled={isInstalling}
        onClick={async () => {
          setIsInstalling(true);
          try {
            await install();
          } finally {
            setIsInstalling(false);
            if (onActionComplete) onActionComplete();
          }
        }}
        className={`w-full text-left px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 flex items-center justify-between font-medium transition-colors ${className}`}
      >
        <div className="flex items-center gap-2">
          <Download className="w-3.5 h-3.5 text-amber-600" />
          <span>Install Store App</span>
        </div>
        <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.5 rounded">
          PWA
        </span>
      </button>
    );
  }

  // If iOS Safari
  if (isIOS) {
    return (
      <>
        <button
          id="pwa-ios-install-menu-btn"
          type="button"
          onClick={() => {
            setShowIOSModal(true);
            if (onActionComplete) onActionComplete();
          }}
          className={`w-full text-left px-3 py-2 text-xs text-amber-700 hover:bg-amber-50 flex items-center justify-between font-medium transition-colors ${className}`}
        >
          <div className="flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-amber-600" />
            <span>Install on iPhone / iPad</span>
          </div>
          <span className="text-[10px] bg-stone-100 text-stone-600 font-semibold px-1.5 py-0.5 rounded">
            iOS
          </span>
        </button>

        <IOSInstallModal isOpen={showIOSModal} onClose={() => setShowIOSModal(false)} />
      </>
    );
  }

  // Not installable in this browser and not installed -> do not render broken/fake button
  return null;
};
