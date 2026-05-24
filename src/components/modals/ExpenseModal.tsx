import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ExpenseModalDesktop from './ExpenseModalDesktop';
import ExpenseModalMobile from './ExpenseModalMobile';

type ExpenseModalProps = ComponentProps<typeof ExpenseModalDesktop>;

export default function ExpenseModal(props: ExpenseModalProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ExpenseModalMobile {...props} /> : <ExpenseModalDesktop {...props} />;
}
