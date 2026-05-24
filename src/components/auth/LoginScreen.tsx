import { usePhoneUi } from '../../hooks/usePhoneUi';
import LoginScreenDesktop from './LoginScreenDesktop';
import LoginScreenMobile from './LoginScreenMobile';
import type { LoginScreenProps } from './LoginTypes';

export function LoginScreen(props: LoginScreenProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <LoginScreenMobile {...props} /> : <LoginScreenDesktop {...props} />;
}
