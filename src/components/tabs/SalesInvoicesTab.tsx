import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SalesInvoicesTabDesktop from './SalesInvoicesTabDesktop';
import SalesInvoicesTabMobile from './SalesInvoicesTabMobile';

type SalesInvoicesTabProps = ComponentProps<typeof SalesInvoicesTabDesktop>;

export default function SalesInvoicesTab(props: SalesInvoicesTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SalesInvoicesTabMobile {...props} /> : <SalesInvoicesTabDesktop {...props} />;
}
