export interface RegisterHeaderProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedProductCount: number;
  saleItemCount: number;
  saleTotal: number;
  scannerProducts: any[];
  handleBarcodeScan: (barcode: string) => void;
  isScannerOpen: boolean;
  onToggleScanner: () => void;
}
