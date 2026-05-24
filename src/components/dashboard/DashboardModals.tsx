import { usePhoneUi } from '../../hooks/usePhoneUi';
import DashboardModalsDesktop from './DashboardModalsDesktop';
import DashboardModalsMobile from './DashboardModalsMobile';
import type { DashboardModalsProps } from './types';

export default function DashboardModals(props: DashboardModalsProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <DashboardModalsMobile {...props} /> : <DashboardModalsDesktop {...props} />;
}
