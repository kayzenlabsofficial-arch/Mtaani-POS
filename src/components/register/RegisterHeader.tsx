import { usePhoneUi } from '../../hooks/usePhoneUi';
import RegisterHeaderDesktop from './RegisterHeaderDesktop';
import RegisterHeaderMobile from './RegisterHeaderMobile';
import type { RegisterHeaderProps } from './RegisterHeaderTypes';

export default function RegisterHeader(props: RegisterHeaderProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <RegisterHeaderMobile {...props} /> : <RegisterHeaderDesktop {...props} />;
}
