import React from 'react';
import { Share, PlusSquare, X } from 'lucide-react';

interface IOSInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IOSInstallModal: React.FC<IOSInstallModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      id="ios-install-modal-backdrop"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="ios-install-modal-content"
        className="w-full max-w-sm rounded-2xl bg-stone-900 border border-stone-800 text-stone-100 p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-stone-950 font-bold flex items-center justify-center text-sm shadow-xs">
              RC
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-tight">Install on iPhone / iPad</h3>
              <p className="text-[10px] text-amber-400 font-medium">Add to Home Screen for standalone app mode</p>
            </div>
          </div>
          <button
            id="close-ios-install-modal-btn"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs text-stone-300">
          <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/70 border border-stone-800/80">
            <div className="w-6 h-6 rounded-lg bg-stone-800 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
              <Share className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white">1. Tap the Share button</p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                In Safari's bottom toolbar (or top bar on iPad), tap the Share icon.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/70 border border-stone-800/80">
            <div className="w-6 h-6 rounded-lg bg-stone-800 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
              <PlusSquare className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-white">2. Select "Add to Home Screen"</p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                Scroll down the action sheet and tap <span className="text-stone-200 font-medium">Add to Home Screen</span>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-2.5 rounded-xl bg-stone-950/70 border border-stone-800/80">
            <div className="w-6 h-6 rounded-lg bg-stone-800 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
              <span className="font-bold text-xs">3</span>
            </div>
            <div>
              <p className="font-semibold text-white">3. Tap "Add" in top-right</p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                Confirm by tapping <span className="text-stone-200 font-medium">Add</span>. The Restaurant Store icon will appear on your home screen.
              </p>
            </div>
          </div>
        </div>

        <button
          id="got-it-ios-install-btn"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs tracking-wide transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
};
