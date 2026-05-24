import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import CategoryManagementModalDesktop from './CategoryManagementModalDesktop';
import CategoryManagementModalMobile from './CategoryManagementModalMobile';

type CategoryManagementModalProps = ComponentProps<typeof CategoryManagementModalDesktop>;

export default function CategoryManagementModal(props: CategoryManagementModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <CategoryManagementModalMobile {...props} /> : <CategoryManagementModalDesktop {...props} />;
}
