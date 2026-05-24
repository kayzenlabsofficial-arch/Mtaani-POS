import AdminApprovalsContent from './AdminApprovalsContent';
import DocumentDetailsModal from '../modals/DocumentDetailsModalMobile';

export default function AdminApprovalsMobile() {
  return <AdminApprovalsContent mode="mobile" DocumentDetailsModal={DocumentDetailsModal} />;
}
