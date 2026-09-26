import { type ByRoleMatcher, type ByRoleOptions, within } from '@testing-library/react';

/**
 * An open MUI overlay (a Dialog, a Menu, a Select popup) portals itself to
 * `body` and marks every sibling — the whole rendered page — `aria-hidden`.
 * Testing Library's role queries read the accessibility tree, so while a confirm
 * stands, `screen.getByRole('button', { name: 'Stop Player 1' })` finds nothing
 * and the page looks empty: what a press behind the question did (or did not)
 * do can otherwise only be asserted once the overlay closes, by which time its
 * answer has run.
 *
 * These queries scope into that hidden subtree and opt into hidden elements, so
 * the page is addressable by role while the overlay owns the screen. The
 * overlay's own controls stay out of scope — they live in the portal, outside
 * this subtree — so one name still means one button.
 */
export const behindOverlay = () => {
  const roots = document.querySelectorAll<HTMLElement>('body > [aria-hidden="true"]');
  if (roots.length !== 1) {
    throw new Error(
      roots.length === 0
        ? 'behindOverlay(): no open overlay hid the page — query it through `screen`.'
        : `behindOverlay(): ${roots.length} hidden roots — a previous render leaked past cleanup.`,
    );
  }
  const page = within(roots[0]);
  return {
    getByRole: (role: ByRoleMatcher, options?: ByRoleOptions) =>
      page.getByRole(role, { ...options, hidden: true }),
    queryByRole: (role: ByRoleMatcher, options?: ByRoleOptions) =>
      page.queryByRole(role, { ...options, hidden: true }),
  };
};
