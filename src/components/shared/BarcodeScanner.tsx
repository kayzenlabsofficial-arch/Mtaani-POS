import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Camera, Zap, AlertTriangle, ScanLine, RefreshCw, Sun } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  isInline?: boolean;
}

type ScannerState = 'idle' | 'requesting' | 'scanning' | 'error';

export default function BarcodeScanner({ onScan, onClose, isInline = false }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = React.useMemo(() => "reader-" + Math.random().toString(36).substring(7), []);
  const cooldownRef = useRef(false);
  const lastScannedRef = useRef<string | null>(null);
  // ── KEY FIX: track starting state via ref, NOT React state ──────────────
  // Using React state here caused startCamera to be recreated on every state
  // change, which caused the useEffect to re-fire → infinite restart loop.
  const isStartingRef = useRef(false);

  const [scannerState, setScannerState] = useState<ScannerState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [flashSuccess, setFlashSuccess] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  const stopAll = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (err) {
        // Suppress stop errors — scanner may already be stopped
        console.warn('[Scanner] stop() error (safe to ignore):', err);
      }
      // Clear the element to prevent "ghost" videos lingering in the DOM
      const container = document.getElementById(containerId);
      if (container) container.innerHTML = '';
      scannerRef.current = null;
    }
    isStartingRef.current = false;
  }, [containerId]);

  const handleDecode = useCallback((code: string) => {
    if (cooldownRef.current) return;
    if (lastScannedRef.current === code) return;

    cooldownRef.current = true;
    lastScannedRef.current = code;
    setLastScanned(code);
    setFlashSuccess(true);

    setTimeout(() => {
      setFlashSuccess(false);
      onScan(code);
      cooldownRef.current = false;
      // Allow the same barcode to be scanned again after 2 seconds
      setTimeout(() => { lastScannedRef.current = null; }, 2000);
    }, 600);
  }, [onScan]);

  const startCamera = useCallback(async () => {
    // ── GUARD: prevent multiple simultaneous start attempts ──────────────────
    // This is now a ref check (not state check) so it doesn't cause re-renders
    // or stale closure issues that would trigger the useEffect again.
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    setScannerState('requesting');
    setErrorMsg('');

    // Always stop any previous instance cleanly before creating a new one
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (_) { /* ignore */ }
      const container = document.getElementById(containerId);
      if (container) container.innerHTML = '';
      scannerRef.current = null;
    }

    try {
      scannerRef.current = new Html5Qrcode(containerId);

      const config = {
        fps: 20,
        qrbox: (viewWidth: number, viewHeight: number) => {
          const size = Math.min(viewWidth, viewHeight) * 0.8;
          return { width: size, height: size * 0.5 };
        },
        videoConstraints: {
          facingMode: { exact: 'environment' },
          width:  { min: 640, ideal: 1920, max: 1920 },
          height: { min: 480, ideal: 1080, max: 1080 },
          aspectRatio: isInline ? 1.777778 : 1.333333,
        },
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      };

      await scannerRef.current.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => handleDecode(decodedText),
        () => {} // Suppress per-frame failure logs
      );

      // Probe for torch support
      try {
        const caps = scannerRef.current.getRunningTrackCapabilities();
        setHasTorch(!!(caps as any).torch);
      } catch {
        setHasTorch(false);
      }

      setScannerState('scanning');
      isStartingRef.current = false;
    } catch (e: any) {
      console.error('[Scanner] start error:', e);

      // ── Fallback: retry with simpler constraints on OverconstrainedError ──
      if (e?.name === 'OverconstrainedError' && scannerRef.current) {
        try {
          // Clean up the failed instance before retrying
          try { await scannerRef.current.stop(); } catch (_) {}
          const container = document.getElementById(containerId);
          if (container) container.innerHTML = '';
          scannerRef.current = new Html5Qrcode(containerId);

          await scannerRef.current.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: { width: 250, height: 150 } },
            (decodedText) => handleDecode(decodedText),
            () => {}
          );
          setScannerState('scanning');
          isStartingRef.current = false;
          return;
        } catch (retryErr: any) {
          setErrorMsg('Camera hardware limit: ' + (retryErr?.message || 'Unknown'));
          setScannerState('error');
          isStartingRef.current = false;
          return;
        }
      }

      let msg = 'Could not access camera.';
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        msg = 'Camera permission denied. Please allow camera access and try again.';
      } else if (e?.name === 'NotFoundError') {
        msg = 'No suitable camera found on this device.';
      } else {
        msg = typeof e === 'string' ? e : (e?.message || 'Unknown error');
      }

      setErrorMsg(msg);
      setScannerState('error');
      isStartingRef.current = false;
    }
  }, [containerId, handleDecode, isInline]); // ← state removed from deps!

  // Start camera once on mount; cleanup on unmount
  useEffect(() => {
    const t = setTimeout(() => { startCamera(); }, 400);
    return () => {
      clearTimeout(t);
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — we only want this to run once on mount

  const toggleTorch = async () => {
    if (!scannerRef.current || !hasTorch) return;
    try {
      const next = !torchEnabled;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: next } as any],
      });
      setTorchEnabled(next);
    } catch (err) {
      console.error('[Scanner] torch toggle failed:', err);
    }
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    handleDecode(code);
    setManualCode('');
  };

  // Retry: fully stop then restart
  const handleRetry = useCallback(async () => {
    await stopAll();
    setScannerState('idle');
    setTimeout(() => startCamera(), 300);
  }, [startCamera, stopAll]);

  const content = (
    <div className={`flex flex-col overflow-hidden ${isInline ? 'bg-slate-900 rounded-3xl shadow-lg mb-4' : 'bg-slate-900 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-sm shadow-2xl relative'}`}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors duration-300 ${
            flashSuccess ? 'bg-green-500' : scannerState === 'scanning' ? 'bg-blue-600' : 'bg-slate-700'
          }`}>
            {flashSuccess ? <Zap size={16} className="text-white" /> : <Camera size={16} className="text-white" />}
          </div>
          <div>
            <h2 className="text-white font-black text-xs leading-tight">Barcode Scanner</h2>
            <p className="text-slate-400 text-[8px] font-bold  ">
              {scannerState === 'scanning' ? 'Live — Point at barcode' : scannerState === 'requesting' ? 'Starting camera...' : scannerState === 'error' ? 'Camera Error' : 'Initializing...'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {hasTorch && scannerState === 'scanning' && (
            <button
              onClick={toggleTorch}
              className={`w-8 h-8 ${torchEnabled ? 'bg-yellow-500 text-slate-900' : 'bg-slate-800 text-slate-400'} rounded-lg flex items-center justify-center hover:opacity-80 transition-all`}
              title="Toggle Flashlight"
            >
              <Sun size={16} />
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="w-8 h-8 bg-slate-800 text-slate-400 rounded-lg flex items-center justify-center hover:bg-slate-700 transition-all">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Camera Viewport */}
      <div className="relative mx-4 mb-2 rounded-2xl overflow-hidden bg-slate-800" style={{ aspectRatio: isInline ? '16/9' : '4/3' }}>
        {/* Html5Qrcode mounts its video element here */}
        <div id={containerId} className="w-full h-full" />

        {/* Scanning overlay */}
        {scannerState === 'scanning' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute inset-0 transition-opacity duration-300 bg-green-500/20 ${flashSuccess ? 'opacity-100' : 'opacity-0'}`} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`relative ${isInline ? 'w-48 h-28' : 'w-56 h-36'} transition-transform duration-300 ${flashSuccess ? 'scale-105' : 'scale-100'}`}>
                {[
                  'top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                  'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                  'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                  'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-6 h-6 ${cls} transition-colors duration-300 ${flashSuccess ? 'border-green-400' : 'border-blue-400'}`} />
                ))}
                {!flashSuccess && <div className="scan-line-animate absolute inset-x-2 h-0.5 bg-blue-400/80 rounded-full shadow-[0_0_8px_2px_rgba(96,165,250,0.5)]" />}
              </div>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {(scannerState === 'idle' || scannerState === 'requesting') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-10">
            <div className="w-8 h-8 border-4 border-slate-600 border-t-blue-500 rounded-full animate-spin mb-2" />
            <p className="text-slate-400 text-[8px] font-bold  ">Starting camera...</p>
          </div>
        )}

        {/* Error overlay */}
        {scannerState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-900 z-10">
            <AlertTriangle className="text-amber-500 mb-2" size={24} />
            <p className="text-white font-bold text-[10px] leading-relaxed mb-4">{errorMsg}</p>
            <button
              onClick={handleRetry}
              className="px-6 py-2 bg-blue-600 text-white text-[10px] font-black rounded-xl shadow-lg shadow-blue-900/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}
      </div>

      {/* Footer — last scanned + manual entry */}
      <div className="px-5 pb-5 flex items-center justify-between gap-4">
        {lastScanned ? (
          <div className="flex flex-col min-w-0">
            <p className="text-[7px] font-black text-slate-500  ">Last Scanned</p>
            <p className={`text-[11px] font-black font-mono truncate ${flashSuccess ? 'text-green-400' : 'text-slate-200'}`}>{lastScanned}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            <p className="text-slate-500 text-[7px] font-black  ">Ready to Scan</p>
            <p className="text-slate-600 text-[6px] font-medium">Native BarcodeDetector + ML fallback</p>
          </div>
        )}

        <div className="flex gap-2 shrink-0">
          <input
            type="text"
            inputMode="numeric"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
            placeholder="Manual code..."
            className="w-24 bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-[10px] font-bold focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleManualSubmit}
            disabled={!manualCode.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-black disabled:opacity-40 shadow-lg shadow-blue-900/20 active:scale-95 transition-all"
          >
            Add
          </button>
        </div>
      </div>

      {/* Scoped styles for Html5Qrcode internal elements + scan line animation */}
      <style>{`
        #${containerId} video {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
          border-radius: 1rem;
        }
        #${containerId} img {
          display: none !important;
        }
        .scan-line-animate {
          animation: scan-line 2s linear infinite;
        }
        @keyframes scan-line {
          0%, 100% { top: 10%; }
          50% { top: 90%; }
        }
      `}</style>
    </div>
  );

  if (isInline) return content;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-4">
      <div className="absolute inset-0 bg-slate-900/85 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <div className="animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 w-full max-w-sm">
        {content}
      </div>
    </div>
  );
}
