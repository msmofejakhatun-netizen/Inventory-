import React, { useEffect, useState } from 'react';
import { WifiOff, AlertCircle } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      id="pwa-offline-notification-bar"
      className="fixed top-0 left-0 right-0 z-50 bg-stone-900 border-b border-amber-500/50 text-stone-100 px-4 py-2 text-xs flex items-center justify-between shadow-lg animate-in slide-in-from-top duration-200"
    >
      <div className="flex items-center gap-2.5 mx-auto">
        <span className="flex h-2.5 w-2.5 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
        </span>
        <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="font-semibold text-white tracking-wide">
          You're offline. Please reconnect to continue.
        </span>
        <span className="hidden sm:inline text-stone-400 text-[11px]">
          (Live inventory, POs, and WhatsApp dispatch require an active network connection)
        </span>
      </div>
    </div>
  );
};
