import { useEffect } from 'react';

/**
 * Name the browser tab while a console is mounted, and put back what was there
 * on the way out.
 *
 * `index.html` ships one static title for the whole SPA, so every console looks
 * alike in the tab strip — and an operator running control + preview + admin
 * side by side picks the wrong window. The restore is what makes it safe to do
 * per page: a client-side nav away leaves the document as it found it, so the
 * title always belongs to the page currently mounted.
 */
export const useDocumentTitle = (title: string) => {
  // Captured once, on mount, so a title that changes mid-life still restores
  // the document's own — not the previous console name.
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = title;
  }, [title]);
};
