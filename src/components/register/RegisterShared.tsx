import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import {
  CartLineItem as CartLineItemDesktop,
  MaterialIcon as MaterialIconDesktop,
  ProductTile as ProductTileDesktop,
} from './RegisterSharedDesktop';
import {
  CartLineItem as CartLineItemMobile,
  MaterialIcon as MaterialIconMobile,
  ProductTile as ProductTileMobile,
} from './RegisterSharedMobile';

type MaterialIconProps = ComponentProps<typeof MaterialIconDesktop>;
type ProductTileProps = ComponentProps<typeof ProductTileDesktop>;
type CartLineItemProps = ComponentProps<typeof CartLineItemDesktop>;

export function MaterialIcon(props: MaterialIconProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <MaterialIconMobile {...props} /> : <MaterialIconDesktop {...props} />;
}

export function ProductTile(props: ProductTileProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ProductTileMobile {...props} /> : <ProductTileDesktop {...props} />;
}

export function CartLineItem(props: CartLineItemProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <CartLineItemMobile {...props} /> : <CartLineItemDesktop {...props} />;
}
