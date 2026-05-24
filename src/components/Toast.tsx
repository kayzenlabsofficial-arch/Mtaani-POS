import { type ComponentProps } from 'react';
import { usePhoneUi } from '../hooks/usePhoneUi';
import ToastDesktop from './ToastDesktop';
import ToastMobile from './ToastMobile';

type ToastProps = ComponentProps<typeof ToastDesktop>;

export default function Toast(props: ToastProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ToastMobile {...props} /> : <ToastDesktop {...props} />;
}
