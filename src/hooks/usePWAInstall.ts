import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    notifyListeners();
  });
}

export function usePWAInstall() {
  const checkIsInstalled = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }, []);

  const [isInstalled, setIsInstalled] = useState<boolean>(checkIsInstalled);
  const [hasPrompt, setHasPrompt] = useState<boolean>(() => !!globalDeferredPrompt);
  const [isIOS, setIsIOS] = useState<boolean>(false);

  useEffect(() => {
    // Check initial state
    setIsInstalled(checkIsInstalled());
    setHasPrompt(!!globalDeferredPrompt);

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(isIOSDevice);

    // Display mode change listener
    const mql = window.matchMedia('(display-mode: standalone)');
    const handleMql = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };

    if (mql.addEventListener) {
      mql.addEventListener('change', handleMql);
    } else if ('addListener' in mql) {
      (mql as any).addListener(handleMql);
    }

    const handleChange = () => {
      setHasPrompt(!!globalDeferredPrompt);
      setIsInstalled(checkIsInstalled());
    };

    listeners.add(handleChange);

    return () => {
      listeners.delete(handleChange);
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handleMql);
      } else if ('removeListener' in mql) {
        (mql as any).removeListener(handleMql);
      }
    };
  }, [checkIsInstalled]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!globalDeferredPrompt) return false;
    try {
      const promptEvent = globalDeferredPrompt;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        globalDeferredPrompt = null;
        setIsInstalled(true);
        setHasPrompt(false);
        notifyListeners();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error prompting PWA installation:', err);
      return false;
    }
  }, []);

  return {
    isInstallable: hasPrompt && !isInstalled,
    isInstalled,
    isIOS: isIOS && !isInstalled,
    install,
  };
}
