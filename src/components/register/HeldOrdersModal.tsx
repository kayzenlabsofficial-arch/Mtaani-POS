import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import HeldOrdersModalDesktop from './HeldOrdersModalDesktop';
import HeldOrdersModalMobile from './HeldOrdersModalMobile';

type HeldOrdersModalProps = ComponentProps<typeof HeldOrdersModalDesktop>;

export default function HeldOrdersModal(props: HeldOrdersModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <HeldOrdersModalMobile {...props} /> : <HeldOrdersModalDesktop {...props} />;
}
