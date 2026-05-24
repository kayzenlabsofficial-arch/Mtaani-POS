import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SuppliersTabDesktop from './SuppliersTabDesktop';
import SuppliersTabMobile from './SuppliersTabMobile';

type SuppliersTabProps = ComponentProps<typeof SuppliersTabDesktop>;

export default function SuppliersTab(props: SuppliersTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SuppliersTabMobile {...props} /> : <SuppliersTabDesktop {...props} />;
}
