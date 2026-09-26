import { useEffect, useRef, useState } from 'react';

/**
 * An element's content width in px, tracked with a `ResizeObserver` — for the
 * surfaces whose art metrics are proportions of a box the CSS cannot name: the
 * `AthleteForm` broadcast preview (scales a fixed-size name strip to the dialog)
 * and the `PlayoffBracket` canvas (keys the overlay type floor to the canvas it
 * actually renders at, not the viewport).
 *
 * Returns 0 until the first measurement and wherever `ResizeObserver` is
 * unavailable (jsdom), so every caller needs an unmeasured fallback that is
 * correct on its own.
 */
export const useElementWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};
