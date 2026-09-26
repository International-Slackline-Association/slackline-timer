import { describe, expect, it } from 'vitest';

import {
  KEY_COMPOSITE_CLASS,
  applyOverlayBodyStyle,
  isChromaBackground,
  isKeyCompositeOverlay,
  resolveOverlayBackground,
} from 'app/pages/Stream/overlayBg';

describe('resolveOverlayBackground', () => {
  it('returns the default transparent fallback when no bg param is present', () => {
    expect(resolveOverlayBackground('')).toBe('transparent');
    expect(resolveOverlayBackground('?compId=foo')).toBe('transparent');
  });

  it('honors a custom fallback when no bg param is present', () => {
    expect(resolveOverlayBackground('', 'var(--tl-chroma-key)')).toBe('var(--tl-chroma-key)');
    expect(resolveOverlayBackground('?round=final', '#000000')).toBe('#000000');
  });

  it('treats an empty bg value as absent (returns the fallback)', () => {
    expect(resolveOverlayBackground('?bg=')).toBe('transparent');
    expect(resolveOverlayBackground('?bg=', 'var(--tl-chroma-key)')).toBe('var(--tl-chroma-key)');
  });

  it('resolves transparent', () => {
    expect(resolveOverlayBackground('?bg=transparent')).toBe('transparent');
  });

  it('resolves key and magenta to the chroma-key var', () => {
    expect(resolveOverlayBackground('?bg=key')).toBe('var(--tl-chroma-key)');
    expect(resolveOverlayBackground('?bg=magenta')).toBe('var(--tl-chroma-key)');
  });

  it('resolves green and blue to their hex presets', () => {
    expect(resolveOverlayBackground('?bg=green')).toBe('#00B140');
    expect(resolveOverlayBackground('?bg=blue')).toBe('#0047BB');
  });

  it('passes an arbitrary CSS color through unchanged', () => {
    expect(resolveOverlayBackground('?bg=rgb(0,0,0)')).toBe('rgb(0,0,0)');
    expect(resolveOverlayBackground('?bg=%23123456')).toBe('#123456');
  });

  it('is case-insensitive for aliases', () => {
    expect(resolveOverlayBackground('?bg=KEY')).toBe('var(--tl-chroma-key)');
    expect(resolveOverlayBackground('?bg=Transparent')).toBe('transparent');
    expect(resolveOverlayBackground('?bg=Green')).toBe('#00B140');
  });

  it('resolves the key-composite mode to a transparent ground', () => {
    expect(resolveOverlayBackground('?bg=h2r')).toBe('transparent');
  });
});

describe('isKeyCompositeOverlay', () => {
  it('recognises the h2r mode (case-insensitively)', () => {
    expect(isKeyCompositeOverlay('?bg=h2r')).toBe(true);
    expect(isKeyCompositeOverlay('?bg=H2R')).toBe(true);
  });

  it('is off for every other mode (incl. absent / plain transparent / chroma)', () => {
    expect(isKeyCompositeOverlay('')).toBe(false);
    expect(isKeyCompositeOverlay('?bg=transparent')).toBe(false);
    expect(isKeyCompositeOverlay('?bg=key')).toBe(false);
    expect(isKeyCompositeOverlay('?bg=%23EC008C')).toBe(false);
  });
});

describe('applyOverlayBodyStyle', () => {
  it('sets the resolved background and restores the previous one on cleanup', () => {
    document.body.style.background = 'rgb(1, 2, 3)';
    const cleanup = applyOverlayBodyStyle('?bg=green');
    expect(document.body.style.background).toBe('rgb(0, 177, 64)');
    cleanup();
    expect(document.body.style.background).toBe('rgb(1, 2, 3)');
    document.body.style.background = '';
  });

  it('toggles the key-composite class for ?bg=h2r (transparent ground)', () => {
    const cleanup = applyOverlayBodyStyle('?bg=h2r');
    expect(document.body.style.background).toBe('transparent');
    expect(document.body.classList.contains(KEY_COMPOSITE_CLASS)).toBe(true);
    cleanup();
    expect(document.body.classList.contains(KEY_COMPOSITE_CLASS)).toBe(false);
    document.body.style.background = '';
  });

  it('never sets the key-composite class for the other modes', () => {
    const cleanup = applyOverlayBodyStyle('?bg=key');
    expect(document.body.classList.contains(KEY_COMPOSITE_CLASS)).toBe(false);
    cleanup();
    document.body.style.background = '';
  });
});

describe('isChromaBackground', () => {
  it('recognises every resolved chroma-key ground', () => {
    expect(isChromaBackground(resolveOverlayBackground('?bg=key'))).toBe(true);
    expect(isChromaBackground(resolveOverlayBackground('?bg=magenta'))).toBe(true);
    expect(isChromaBackground(resolveOverlayBackground('?bg=green'))).toBe(true);
    expect(isChromaBackground(resolveOverlayBackground('?bg=blue'))).toBe(true);
    // A raw magenta passed as a custom colour is still the chroma key.
    expect(isChromaBackground('#FF00FF')).toBe(true);
  });

  it('treats transparent and custom colours as non-chroma', () => {
    expect(isChromaBackground('transparent')).toBe(false);
    expect(isChromaBackground('#123456')).toBe(false);
    expect(isChromaBackground('rgb(0,0,0)')).toBe(false);
  });
});
