import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import OpenShiftModalDesktop from './OpenShiftModalDesktop';
import OpenShiftModalMobile from './OpenShiftModalMobile';

type OpenShiftModalProps = ComponentProps<typeof OpenShiftModalDesktop>;

export default function OpenShiftModal(props: OpenShiftModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <OpenShiftModalMobile {...props} /> : <OpenShiftModalDesktop {...props} />;
}
