import BarcodeScanner from '../shared/BarcodeScannerMobile';

export default function RegisterScannerPanelMobile({
  open,
  onScan,
  onClose,
}: {
  open: boolean;
  onScan: (barcode: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <BarcodeScanner onScan={barcode => onScan(barcode)} onClose={onClose} />
  );
}
