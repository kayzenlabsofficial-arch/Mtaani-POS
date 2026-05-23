import BarcodeScanner from '../shared/BarcodeScanner';

export default function RegisterScannerPanel({
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
