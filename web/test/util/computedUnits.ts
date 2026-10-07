/**
 * Resolving authored CSS units the way `getComputedStyle` now reports them.
 *
 * jsdom's `getComputedStyle` is spec-correct: relative units resolve to
 * absolute px. jsdom's px output says nothing about the art metric it encodes,
 * so tests assert the authored value and resolve it here. The authored strings stay independent of `app/util/overlayScale` — they
 * are the expected output of `refVw`/`refVh`, not a re-derivation of them.
 *
 * Resolving against `window.innerWidth/innerHeight` rather than a hard-coded
 * 1024×768 keeps these correct if the jsdom viewport is ever configured.
 */

import { createRequire } from 'node:module';

/** The numeric px of a computed value, e.g. `'441.856px'` -> `441.856`. */
export const px = (computed: string): number => parseFloat(computed);

/** px jsdom reports for an authored `vw` value, e.g. `refVw(828.48)`. */
export const vwPx = (authored: string): number => (parseFloat(authored) / 100) * window.innerWidth;

/** px jsdom reports for an authored `vh` value, e.g. `refVh(32)`. */
export const vhPx = (authored: string): number => (parseFloat(authored) / 100) * window.innerHeight;

/**
 * The font size `em` resolves against on `el`. jsdom reports no length for an
 * element that declares no `font-size`, so walk up to the nearest one that
 * does — which is what inheritance resolves to — and fall back to the CSS
 * initial `medium` (16px).
 */
const fontSizePx = (el: Element): number => {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const size = parseFloat(window.getComputedStyle(node).fontSize);
    if (!Number.isNaN(size)) return size;
  }
  return 16;
};

/**
 * px jsdom reports for an authored `em` value. `em` resolves against the
 * element's own font size, so pass the element carrying the declaration —
 * which also pins that the value scales with the intended box.
 */
export const emPx = (authored: string, el: Element): number =>
  parseFloat(authored) * fontSizePx(el);

/**
 * The inner global jsdom resolves viewport units against. jsdom 30 keeps it
 * SEPARATE from the `window` a test sees, so assigning `window.innerWidth` moves
 * the helpers above but leaves `getComputedStyle` on the hard-coded 1024×768.
 * It is only reachable through a node's impl. Since 30.1 that link is a
 * `#private` field, readable only via jsdom's own `implForWrapper` — which must
 * be the module instance the environment loaded, hence the CJS `require`.
 */
const { implForWrapper } = createRequire(import.meta.url)('jsdom/lib/generated/idl/utils.js') as {
  implForWrapper: (wrapper: unknown) => { _globalObject?: object } | null;
};

const viewportTargets = (): object[] => {
  const impl = implForWrapper(document.documentElement);
  return [window, impl?._globalObject].filter((target): target is object => target != null);
};

/**
 * Pin the viewport `vw`/`vh` resolve against, on both of the above. The
 * `/stream/*` overlays are captured at exactly 1920×1080 and their geometry is
 * authored off that frame, so a suite asserting overlay metrics has to say which
 * capture it is measuring. Returns a restore fn for the suite's `afterEach`.
 */
export const pinViewport = (width: number, height: number): (() => void) => {
  const targets = viewportTargets();
  const before = { width: window.innerWidth, height: window.innerHeight };
  const set = (w: number, h: number): void => {
    for (const target of targets) {
      Object.defineProperty(target, 'innerWidth', { value: w, configurable: true });
      Object.defineProperty(target, 'innerHeight', { value: h, configurable: true });
    }
  };
  set(width, height);
  return () => set(before.width, before.height);
};
