import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import SettingsTabDesktop from './SettingsTabDesktop';
import SettingsTabMobile from './SettingsTabMobile';

type SettingsTabProps = ComponentProps<typeof SettingsTabDesktop>;

export default function SettingsTab(props: SettingsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SettingsTabMobile {...props} /> : <SettingsTabDesktop {...props} />;
}
