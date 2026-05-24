import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import BarcodeScannerDesktop from './BarcodeScannerDesktop';
import BarcodeScannerMobile from './BarcodeScannerMobile';

type BarcodeScannerProps = ComponentProps<typeof BarcodeScannerDesktop>;

export default function BarcodeScanner(props: BarcodeScannerProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <BarcodeScannerMobile {...props} /> : <BarcodeScannerDesktop {...props} />;
}
