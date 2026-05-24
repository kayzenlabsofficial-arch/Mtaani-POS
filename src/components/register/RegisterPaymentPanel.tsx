import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import RegisterPaymentPanelDesktop from './RegisterPaymentPanelDesktop';
import RegisterPaymentPanelMobile from './RegisterPaymentPanelMobile';

type RegisterPaymentPanelProps = ComponentProps<typeof RegisterPaymentPanelDesktop>;

export default function RegisterPaymentPanel(props: RegisterPaymentPanelProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <RegisterPaymentPanelMobile {...props} /> : <RegisterPaymentPanelDesktop {...props} />;
}
