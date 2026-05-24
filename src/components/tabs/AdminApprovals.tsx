import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import AdminApprovalsDesktop from './AdminApprovalsDesktop';
import AdminApprovalsMobile from './AdminApprovalsMobile';

type AdminApprovalsProps = ComponentProps<typeof AdminApprovalsDesktop>;

export default function AdminApprovals(props: AdminApprovalsProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <AdminApprovalsMobile {...props} /> : <AdminApprovalsDesktop {...props} />;
}
