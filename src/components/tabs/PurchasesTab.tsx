import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import PurchasesTabDesktop from './PurchasesTabDesktop';
import PurchasesTabMobile from './PurchasesTabMobile';

type PurchasesTabProps = ComponentProps<typeof PurchasesTabDesktop>;

export default function PurchasesTab(props: PurchasesTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <PurchasesTabMobile {...props} /> : <PurchasesTabDesktop {...props} />;
}
