import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SystemManagerDashboardDesktop from './SystemManagerDesktop';
import SystemManagerDashboardMobile from './SystemManagerMobile';

type SystemManagerDashboardProps = ComponentProps<typeof SystemManagerDashboardDesktop>;

export default function SystemManagerDashboard(props: SystemManagerDashboardProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SystemManagerDashboardMobile {...props} /> : <SystemManagerDashboardDesktop {...props} />;
}
