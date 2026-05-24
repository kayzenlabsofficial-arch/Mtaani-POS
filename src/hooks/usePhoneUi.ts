import { useEffect, useState } from 'react';

const PHONE_UI_QUERY = '(max-width: 1023px)';

export function usePhoneUi(query = PHONE_UI_QUERY) {
  const getIsPhoneUi = () => (
    typeof window !== 'undefined'
      ? window.matchMedia(query).matches
      : false
  );

  const [isPhoneUi, setIsPhoneUi] = useState(getIsPhoneUi);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setIsPhoneUi(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return isPhoneUi;
}
