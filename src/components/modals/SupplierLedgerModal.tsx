import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SupplierLedgerModalDesktop from './SupplierLedgerModalDesktop';
import SupplierLedgerModalMobile from './SupplierLedgerModalMobile';

type SupplierLedgerModalProps = ComponentProps<typeof SupplierLedgerModalDesktop>;

export default function SupplierLedgerModal(props: SupplierLedgerModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SupplierLedgerModalMobile {...props} /> : <SupplierLedgerModalDesktop {...props} />;
}
