import React from 'react';
import type { RegisterHeaderProps } from './RegisterHeaderTypes';
import { useDesktopSubnav } from '../navigation/DesktopSubnav';

export default function RegisterHeaderDesktop({
  searchQuery,
  setSearchQuery,
  selectedProductCount,
  saleItemCount,
  saleTotal,
  scannerProducts,
  handleBarcodeScan,
  isScannerOpen,
  onToggleScanner,
}: RegisterHeaderProps) {
  const subnavConfig = React.useMemo(() => ({
    id: 'register',
    label: 'Register',
    search: {
      value: searchQuery,
      placeholder: 'Search product or barcode',
      onChange: setSearchQuery,
      onClear: () => setSearchQuery(''),
      onEnter: (value: string) => {
        const code = value.trim();
        const product = scannerProducts.find(item => String(item.barcode || '').trim() === code);
        if (product) handleBarcodeScan(code);
      },
    },
    summary: [
      { label: 'Products', value: selectedProductCount.toLocaleString() },
      { label: 'Items', value: saleItemCount.toLocaleString() },
      { label: 'Sale', value: `Ksh ${saleTotal.toLocaleString()}` },
    ],
    actions: [
      {
        id: 'scan',
        label: isScannerOpen ? 'Close scanner' : 'Scan',
        icon: 'scan',
        onClick: onToggleScanner,
      },
    ],
  }), [
    handleBarcodeScan,
    isScannerOpen,
    onToggleScanner,
    saleItemCount,
    saleTotal,
    scannerProducts,
    searchQuery,
    selectedProductCount,
    setSearchQuery,
  ]);

  useDesktopSubnav(subnavConfig);

  return null;
}
