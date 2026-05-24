import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import HRTabDesktop from './HRTabDesktop';
import HRTabMobile from './HRTabMobile';

type HRTabProps = ComponentProps<typeof HRTabDesktop>;

export default function HRTab(props: HRTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <HRTabMobile {...props} /> : <HRTabDesktop {...props} />;
}
