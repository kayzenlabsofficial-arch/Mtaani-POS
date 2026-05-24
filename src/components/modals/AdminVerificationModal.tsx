import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import AdminVerificationModalDesktop from './AdminVerificationModalDesktop';
import AdminVerificationModalMobile from './AdminVerificationModalMobile';

type AdminVerificationModalProps = ComponentProps<typeof AdminVerificationModalDesktop>;

export default function AdminVerificationModal(props: AdminVerificationModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <AdminVerificationModalMobile {...props} /> : <AdminVerificationModalDesktop {...props} />;
}
