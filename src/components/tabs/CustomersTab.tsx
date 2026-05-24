import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import CustomersTabDesktop from './CustomersTabDesktop';
import CustomersTabMobile from './CustomersTabMobile';

type CustomersTabProps = ComponentProps<typeof CustomersTabDesktop>;

export default function CustomersTab(props: CustomersTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <CustomersTabMobile {...props} /> : <CustomersTabDesktop {...props} />;
}
