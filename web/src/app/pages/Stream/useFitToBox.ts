import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A box's USED size in fractional px. `clientWidth`/`scrollWidth` round to
 * integers, so a 43.6px slot reads 44 against 69.06px of content reading 69 —
 * a fit ~1% too generous, which paints the scaled block past the slot's
 * `overflow:hidden` edge and shaves the outer glyph stems (visible on the small
 * admin bracket cards). The computed style reports the used box unrounded and
 * ignores transforms, so it measures the same natural box the scale is applied
 * to. jsdom resolves no layout (`width: '100%'`, not px) — fall back to the
 * integer box there, and in any engine that reports a non-px used value.
 */
const usedSize = (el: HTMLElement, fallback: { w: number; h: number }) => {
  const { width, height } = getComputedStyle(el);
  const px = (value: string, integer: number) =>
    value.endsWith('px') ? parseFloat(value) : integer;
  return { w: px(width, fallback.w), h: px(height, fallback.h) };
};

/**
 * Shrink-to-fit for an overlay name/label block: measures the content's natural
 * (untransformed) size against its slot and returns a `fit` scale that the
 * caller applies as `transform: scale(fit)` — short content stays at full size,
 * only an overflowing block is scaled down (instead of clipping mid-letter). The
 * slot is the `overflow:hidden` box; the measured node is the content-sized
 * block inside it. Neither the used size nor `scrollWidth`/`scrollHeight`
 * reflects the transform, so re-measuring never feeds back. The display face
 * loads async (the pre-swap fallback measures wider/narrower), so re-measure on
 * `document.fonts.ready`. jsdom reports 0 for every dimension (no layout), so
 * the fit stays 1 there.
 */
const useFit = (fitHeight: boolean) => {
  const slotRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const name = nameRef.current;
    if (!slot || !name) return undefined;
    const ratio = (available: number, natural: number) =>
      natural > available && available > 0 ? available / natural : 1;
    const measure = () => {
      const box = usedSize(slot, { w: slot.clientWidth, h: slot.clientHeight });
      const content = usedSize(name, { w: name.scrollWidth, h: name.scrollHeight });
      const widthFit = ratio(box.w, content.w);
      const heightFit = fitHeight ? ratio(box.h, content.h) : 1;
      setFit(Math.min(widthFit, heightFit));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => undefined);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [fitHeight]);
  return { slotRef, nameRef, fit };
};

/** Width-only fit, for the single-line name strips and rankings/scorecard plates. */
export const useFitToWidth = () => useFit(false);

/**
 * Both-axis fit, for a stacked block that can outgrow its slot vertically too —
 * the athlete card's name + result + caption column, where yielding height would
 * shear the family name's glyphs instead of shrinking the whole stack.
 */
export const useFitToBox = () => useFit(true);
