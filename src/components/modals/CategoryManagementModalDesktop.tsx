import CategoryManagementModalView, { type CategoryManagementModalViewProps } from './CategoryManagementModalView';

type CategoryManagementModalProps = Omit<CategoryManagementModalViewProps, 'isMobile'>;

export default function CategoryManagementModalDesktop(props: CategoryManagementModalProps) {
  return <CategoryManagementModalView {...props} />;
}
