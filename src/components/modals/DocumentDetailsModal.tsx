import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import DocumentDetailsModalDesktop from './DocumentDetailsModalDesktop';
import DocumentDetailsModalMobile from './DocumentDetailsModalMobile';

type DocumentDetailsModalProps = ComponentProps<typeof DocumentDetailsModalDesktop>;

export default function DocumentDetailsModal(props: DocumentDetailsModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <DocumentDetailsModalMobile {...props} /> : <DocumentDetailsModalDesktop {...props} />;
}
