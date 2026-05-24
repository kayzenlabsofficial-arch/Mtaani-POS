import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import { ProductCard as ProductCardDesktop } from './ProductCardDesktop';
import { ProductCard as ProductCardMobile } from './ProductCardMobile';

type ProductCardProps = ComponentProps<typeof ProductCardDesktop>;

export function ProductCard(props: ProductCardProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ProductCardMobile {...props} /> : <ProductCardDesktop {...props} />;
}
