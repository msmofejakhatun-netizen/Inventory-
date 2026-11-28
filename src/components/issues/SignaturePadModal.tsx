import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eraser, Loader2, PenTool } from 'lucide-react';
import { Modal } from '../common/Modal';

interface SignatureCanvasProps {
  id?: string;
  height?: number;
  initialDataUrl?: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

/**
 * Responsive touch- and mouse-capable HTML5 Canvas signature pad.
 * Renders crisp Deep Navy ink on white background and exports compact PNG data URLs.
 */
export const SignatureCanvas: React.FC<SignatureCanvasProps> = ({
  id = 'signature-canvas',
  height = 150,
  initialDataUrl = null,
  onChange,
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const hasInkRef = useRef(Boolean(initialDataUrl));
  const [hasInk, setHasInk] = useState(Boolean(initialDataUrl));
  const lastRestoredUrlRef = useRef<string | null>(null);

  const initializeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width || 420));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#0D2149';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  useEffect(() => {
    initializeCanvas();
    if (initialDataUrl && initialDataUrl.startsWith('data:image/png;base64,')) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const img = new Image();
        img.onload = () => {
          const rect = canvas.getBoundingClientRect();
          const width = Math.max(280, Math.floor(rect.width || 420));
          ctx.drawImage(img, 0, 0, width, height);
          hasInkRef.current = true;
          setHasInk(true);
          lastRestoredUrlRef.current = initialDataUrl;
        };
        img.src = initialDataUrl;
      }
    }
  }, [height]);

  useEffect(() => {
    if (
      initialDataUrl &&
      initialDataUrl !== lastRestoredUrlRef.current &&
      !isDrawingRef.current &&
      initialDataUrl.startsWith('data:image/png;base64,')
    ) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const img = new Image();
        img.onload = () => {
          const rect = canvas.getBoundingClientRect();
          const width = Math.max(280, Math.floor(rect.width || 420));
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          hasInkRef.current = true;
          setHasInk(true);
          lastRestoredUrlRef.current = initialDataUrl;
        };
        img.src = initialDataUrl;
      }
    } else if (!initialDataUrl && lastRestoredUrlRef.current && !isDrawingRef.current) {
      lastRestoredUrlRef.current = null;
      hasInkRef.current = false;
      setHasInk(false);
      initializeCanvas();
    }
  }, [initialDataUrl, height]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPoint(e);
    isDrawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Draw a small dot in case user taps/dots their signature
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();

    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    e.preventDefault();
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if pointer already released
      }
      if (hasInkRef.current) {
        onChange(canvas.toDataURL('image/png'));
      }
    }
  };

  const handleClear = () => {
    if (disabled) return;
    hasInkRef.current = false;
    setHasInk(false);
    initializeCanvas();
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-dashed border-stone-300 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          id={id}
          style={{ height: `${height}px`, touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className={`w-full block ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-crosshair'}`}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-stone-400 select-none">
            <PenTool className="w-5 h-5 mb-1 opacity-60" />
            <span className="text-xs font-medium">Sign here with mouse or finger</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-stone-500">
          {hasInk ? 'Signature captured — ready to save.' : 'Draw your signature inside the box above.'}
        </span>
        <button
          id={`${id}-clear-btn`}
          type="button"
          disabled={disabled || !hasInk}
          onClick={handleClear}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-stone-200 text-stone-600 hover:bg-stone-50 font-semibold disabled:opacity-40"
        >
          <Eraser className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};

interface SignaturePadModalProps {
  isOpen: boolean;
  title: string;
  subtitle: string;
  signerName: string;
  signerRoleLabel: string;
  sessionSummary: string;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => Promise<void>;
}

export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  isOpen,
  title,
  subtitle,
  signerName,
  signerRoleLabel,
  sessionSummary,
  onClose,
  onSave,
}) => {
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSignatureDataUrl(null);
      setSaving(false);
      setError(null);
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!signatureDataUrl) {
      setError('Please draw your signature before saving.');
      return;
    }
    setError(null);
    try {
      setSaving(true);
      await onSave(signatureDataUrl);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save signature. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      id="issue-signature-pad-modal"
      isOpen={isOpen}
      onClose={() => !saving && onClose()}
      title={title}
      subtitle={subtitle}
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl bg-[#0D2149] text-white text-xs space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">
            Verification Context
          </p>
          <p className="font-bold text-white">{sessionSummary}</p>
          <p className="text-slate-300 text-[11px]">
            Signing as: <span className="font-bold text-white">{signerName}</span> ({signerRoleLabel})
          </p>
        </div>

        <SignatureCanvas
          id="issue-modal-signature-canvas"
          height={165}
          disabled={saving}
          onChange={(url) => {
            setSignatureDataUrl(url);
            if (error) setError(null);
          }}
        />

        <p className="text-[11px] text-stone-500 leading-relaxed">
          This signature will be permanently bound to this specific issue session and cannot be reused for other sessions or overwritten once saved.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50 rounded-lg border border-stone-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id="save-issue-signature-btn"
            type="button"
            disabled={saving || !signatureDataUrl}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0D2149] hover:bg-[#153168] text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Signature...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-[#FF5A1F]" />
                <span>Save Signature</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
