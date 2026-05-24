import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ReportsTabDesktop from './ReportsTabDesktop';
import ReportsTabMobile from './ReportsTabMobile';

type ReportsTabProps = ComponentProps<typeof ReportsTabDesktop>;

export default function ReportsTab(props: ReportsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ReportsTabMobile {...props} /> : <ReportsTabDesktop {...props} />;
}
