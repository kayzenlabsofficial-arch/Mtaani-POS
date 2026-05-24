import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import AdminPanelDesktop from './AdminPanelDesktop';
import AdminPanelMobile from './AdminPanelMobile';

type AdminPanelProps = ComponentProps<typeof AdminPanelDesktop>;

export default function AdminPanel(props: AdminPanelProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <AdminPanelMobile {...props} /> : <AdminPanelDesktop {...props} />;
}
