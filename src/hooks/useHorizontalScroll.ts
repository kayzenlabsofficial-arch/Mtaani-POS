import { useRef, useEffect } from 'react';

export function useHorizontalScroll() {
  const elRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const el = elRef.current;
    if (el) {
      const onWheel = (e: WheelEvent) => {
        if (e.deltaY === 0) return;
        
        // Convert vertical scroll to horizontal scroll
        e.preventDefault();
        el.scrollTo({
          left: el.scrollLeft + e.deltaY,
          behavior: 'smooth' // or 'auto'
        });
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }
  }, []);
  
  return elRef;
}
