import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import DocumentsTabDesktop from './DocumentsTabDesktop';
import DocumentsTabMobile from './DocumentsTabMobile';

type DocumentsTabProps = ComponentProps<typeof DocumentsTabDesktop>;

export default function DocumentsTab(props: DocumentsTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <DocumentsTabMobile {...props} /> : <DocumentsTabDesktop {...props} />;
}
