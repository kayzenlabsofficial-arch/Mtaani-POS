import { useEffect, useState } from 'react';

export type VisualViewportState = {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
};

const FALLBACK_VIEWPORT: VisualViewportState = {
  width: 0,
  height: 0,
  offsetTop: 0,
  offsetLeft: 0,
  keyboardInset: 0,
  isKeyboardOpen: false,
};

function readVisualViewport(): VisualViewportState {
  if (typeof window === 'undefined') return FALLBACK_VIEWPORT;

  const layoutWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || layoutWidth);
  const height = Math.round(viewport?.height || layoutHeight);
  const offsetTop = Math.round(viewport?.offsetTop || 0);
  const offsetLeft = Math.round(viewport?.offsetLeft || 0);
  const keyboardInset = Math.max(0, Math.round(layoutHeight - height - offsetTop));
  const isKeyboardOpen = keyboardInset > 80 || (layoutHeight > 0 && height < layoutHeight * 0.78);

  return { width, height, offsetTop, offsetLeft, keyboardInset, isKeyboardOpen };
}

export function useVisualViewport() {
  const [state, setState] = useState<VisualViewportState>(() => readVisualViewport());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setState(readVisualViewport()));
    };

    update();
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('scroll', update, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
