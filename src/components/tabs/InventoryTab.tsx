import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import InventoryTabDesktop from './InventoryTabDesktop';
import InventoryTabMobile from './InventoryTabMobile';

type InventoryTabProps = ComponentProps<typeof InventoryTabDesktop>;

export default function InventoryTab(props: InventoryTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <InventoryTabMobile {...props} /> : <InventoryTabDesktop {...props} />;
}
