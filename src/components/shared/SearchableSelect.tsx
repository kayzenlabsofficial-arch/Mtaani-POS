import { usePhoneUi } from '../../hooks/usePhoneUi';
import { SearchableSelect as SearchableSelectDesktop } from './SearchableSelectDesktop';
import { SearchableSelect as SearchableSelectMobile } from './SearchableSelectMobile';
export type { SearchableSelectOption } from './SearchableSelectDesktop';

type SearchableSelectProps<T extends string = string> = Parameters<typeof SearchableSelectDesktop<T>>[0];

export function SearchableSelect<T extends string = string>(props: SearchableSelectProps<T>) {
  const isPhoneUi = usePhoneUi();
  return isPhoneUi ? <SearchableSelectMobile {...props} /> : <SearchableSelectDesktop {...props} />;
}
