import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ProductSearchModalDesktop from './ProductSearchModalDesktop';
import ProductSearchModalMobile from './ProductSearchModalMobile';

type ProductSearchModalProps = ComponentProps<typeof ProductSearchModalDesktop>;

export default function ProductSearchModal(props: ProductSearchModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ProductSearchModalMobile {...props} /> : <ProductSearchModalDesktop {...props} />;
}
