import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import MainAccountTabDesktop from './MainAccountTabDesktop';
import MainAccountTabMobile from './MainAccountTabMobile';

type MainAccountTabProps = ComponentProps<typeof MainAccountTabDesktop>;

export default function MainAccountTab(props: MainAccountTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <MainAccountTabMobile {...props} /> : <MainAccountTabDesktop {...props} />;
}
