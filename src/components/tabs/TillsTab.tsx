import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import TillsTabDesktop from './TillsTabDesktop';
import TillsTabMobile from './TillsTabMobile';

type TillsTabProps = ComponentProps<typeof TillsTabDesktop>;

export default function TillsTab(props: TillsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <TillsTabMobile {...props} /> : <TillsTabDesktop {...props} />;
}
