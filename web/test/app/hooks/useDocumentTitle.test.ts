import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDocumentTitle } from 'app/hooks/useDocumentTitle';

const INDEX_TITLE = 'Slackline Timer';

afterEach(() => {
  document.title = INDEX_TITLE;
});

describe('useDocumentTitle', () => {
  it('retitles the tab while the console is mounted', () => {
    document.title = INDEX_TITLE;

    renderHook(() => useDocumentTitle('Freestyle Timer'));

    expect(document.title).toBe('Freestyle Timer');
  });

  it('restores what it found on unmount (SPA nav-away)', () => {
    document.title = INDEX_TITLE;

    const { unmount } = renderHook(() => useDocumentTitle('Freestyle Timer'));
    unmount();

    expect(document.title).toBe(INDEX_TITLE);
  });

  it('follows a changed title without losing the original', () => {
    document.title = INDEX_TITLE;

    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Freestyle Timer' },
    });
    rerender({ title: 'Speedline Timer' });
    expect(document.title).toBe('Speedline Timer');

    unmount();
    expect(document.title).toBe(INDEX_TITLE);
  });
});
