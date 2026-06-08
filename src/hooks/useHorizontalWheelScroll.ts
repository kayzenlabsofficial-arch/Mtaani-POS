import { useEffect, useRef } from 'react';

const WHEEL_SCROLL_DAMPING = 0.38;

export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      if (element.scrollWidth <= element.clientWidth) return;

      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const rawDelta = absX > absY ? event.deltaX : event.deltaY;
      const modeMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? element.clientWidth
          : 1;
      const delta = rawDelta * modeMultiplier * WHEEL_SCROLL_DAMPING;
      if (!delta) return;

      const maxScroll = element.scrollWidth - element.clientWidth;
      const nextScroll = Math.max(0, Math.min(maxScroll, element.scrollLeft + delta));
      if (nextScroll === element.scrollLeft) return;

      element.scrollTo({ left: nextScroll, behavior: 'smooth' });
      event.preventDefault();
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}
