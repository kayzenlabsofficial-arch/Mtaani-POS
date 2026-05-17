import { useEffect, useRef } from 'react';
import {
  startAssignedHidBarcodeScanner,
  startAssignedSerialBarcodeScanner,
  startKeyboardBarcodeScanner,
} from '../utils/hardware';

type Cleanup = () => void | Promise<void>;

interface UseHardwareBarcodeScannerOptions {
  enabled?: boolean;
  onError?: (message: string) => void;
}

export function useHardwareBarcodeScanner(
  onBarcode: (barcode: string) => void,
  options: UseHardwareBarcodeScannerOptions = {},
) {
  const onBarcodeRef = useRef(onBarcode);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onBarcodeRef.current = onBarcode;
  }, [onBarcode]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    if (options.enabled === false) return;

    let cancelled = false;
    const cleanups: Cleanup[] = [];
    const emitBarcode = (barcode: string) => onBarcodeRef.current(barcode);
    const reportError = (err: any) => {
      const message = err?.message || 'Hardware scanner could not start.';
      console.warn('[Hardware scanner]', err);
      onErrorRef.current?.(message);
    };

    const keyboardCleanup = startKeyboardBarcodeScanner(emitBarcode);
    if (keyboardCleanup) cleanups.push(keyboardCleanup);

    void startAssignedSerialBarcodeScanner(emitBarcode)
      .then((cleanup) => {
        if (!cleanup) return;
        if (cancelled) void cleanup();
        else cleanups.push(cleanup);
      })
      .catch(reportError);

    void startAssignedHidBarcodeScanner(emitBarcode)
      .then((cleanup) => {
        if (!cleanup) return;
        if (cancelled) void cleanup();
        else cleanups.push(cleanup);
      })
      .catch(reportError);

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => void cleanup());
    };
  }, [options.enabled]);
}
