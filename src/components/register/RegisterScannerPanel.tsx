import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import RegisterScannerPanelDesktop from './RegisterScannerPanelDesktop';
import RegisterScannerPanelMobile from './RegisterScannerPanelMobile';

type RegisterScannerPanelProps = ComponentProps<typeof RegisterScannerPanelDesktop>;

export default function RegisterScannerPanel(props: RegisterScannerPanelProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <RegisterScannerPanelMobile {...props} /> : <RegisterScannerPanelDesktop {...props} />;
}
