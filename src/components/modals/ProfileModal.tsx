import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ProfileModalDesktop from './ProfileModalDesktop';
import ProfileModalMobile from './ProfileModalMobile';

type ProfileModalProps = ComponentProps<typeof ProfileModalDesktop>;

export default function ProfileModal(props: ProfileModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ProfileModalMobile {...props} /> : <ProfileModalDesktop {...props} />;
}
