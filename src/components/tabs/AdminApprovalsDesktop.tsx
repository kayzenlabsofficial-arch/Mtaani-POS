import AdminApprovalsContent from './AdminApprovalsContent';
import DocumentDetailsModal from '../modals/DocumentDetailsModalDesktop';

export default function AdminApprovalsDesktop() {
  return <AdminApprovalsContent mode="desktop" DocumentDetailsModal={DocumentDetailsModal} />;
}
