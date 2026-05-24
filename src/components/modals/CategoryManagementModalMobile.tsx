import CategoryManagementModalView, { type CategoryManagementModalViewProps } from './CategoryManagementModalView';

type CategoryManagementModalProps = Omit<CategoryManagementModalViewProps, 'isMobile'>;

export default function CategoryManagementModalMobile(props: CategoryManagementModalProps) {
  return <CategoryManagementModalView {...props} isMobile />;
}
