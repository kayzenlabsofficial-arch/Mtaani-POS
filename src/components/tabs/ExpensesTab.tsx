import { type ComponentProps } from 'react';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import ExpensesTabDesktop from './ExpensesTabDesktop';
import ExpensesTabMobile from './ExpensesTabMobile';

type ExpensesTabProps = ComponentProps<typeof ExpensesTabDesktop>;

export default function ExpensesTab(props: ExpensesTabProps) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <ExpensesTabMobile {...props} /> : <ExpensesTabDesktop {...props} />;
}
