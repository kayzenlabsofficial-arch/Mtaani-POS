import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SupplierPaymentsTabDesktop from './SupplierPaymentsTabDesktop';
import SupplierPaymentsTabMobile from './SupplierPaymentsTabMobile';

type SupplierPaymentsTabProps = ComponentProps<typeof SupplierPaymentsTabDesktop>;

export default function SupplierPaymentsTab(props: SupplierPaymentsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SupplierPaymentsTabMobile {...props} /> : <SupplierPaymentsTabDesktop {...props} />;
}
