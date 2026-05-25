import { type Transaction } from '../../db';
import DocumentPdfModalView from './DocumentPdfModalView';

interface ReceiptDetailsModalProps {
  selectedReceipt: Transaction | null;
  setSelectedReceipt: (receipt: Transaction | null) => void;
  handleRefund: (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => Promise<void>;
}

export default function ReceiptDetailsModalDesktop({ selectedReceipt, setSelectedReceipt, handleRefund }: ReceiptDetailsModalProps) {
  return (
    <DocumentPdfModalView
      selectedRecord={selectedReceipt}
      setSelectedRecord={record => setSelectedReceipt(record as Transaction | null)}
      handleRefund={handleRefund}
    />
  );
}
