import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import RefundsTabDesktop from './RefundsTabDesktop';
import RefundsTabMobile from './RefundsTabMobile';

type RefundsTabProps = ComponentProps<typeof RefundsTabDesktop>;

export default function RefundsTab(props: RefundsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <RefundsTabMobile {...props} /> : <RefundsTabDesktop {...props} />;
}
