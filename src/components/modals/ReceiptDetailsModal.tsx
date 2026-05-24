import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ReceiptDetailsModalDesktop from './ReceiptDetailsModalDesktop';
import ReceiptDetailsModalMobile from './ReceiptDetailsModalMobile';

type ReceiptDetailsModalProps = ComponentProps<typeof ReceiptDetailsModalDesktop>;

export default function ReceiptDetailsModal(props: ReceiptDetailsModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ReceiptDetailsModalMobile {...props} /> : <ReceiptDetailsModalDesktop {...props} />;
}
