import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SidebarDesktop from './SidebarDesktop';
import SidebarMobile from './SidebarMobile';

type SidebarProps = ComponentProps<typeof SidebarDesktop>;

export default function Sidebar(props: SidebarProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SidebarMobile {...props} /> : <SidebarDesktop {...props} />;
}
