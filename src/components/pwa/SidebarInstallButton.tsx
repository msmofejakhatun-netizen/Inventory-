import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const SidebarInstallButton: React.FC = () => {
  const { isInstallable, install } = usePWAInstall();
  const [installing, setInstalling] = useState(false);

  if (!isInstallable) return null;

  return (
    <div className="px-3 py-2 border-t border-stone-800/80 bg-stone-900/60">
      <button
        id="sidebar-install-pwa-btn"
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
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-xs font-semibold transition-all group shadow-2xs"
      >
        <div className="flex items-center gap-2">
          <Download className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
          <span>Install App</span>
        </div>
        <span className="text-[10px] bg-amber-500/30 text-amber-200 px-1.5 py-0.2 rounded font-mono">
          PWA
        </span>
      </button>
    </div>
  );
};
