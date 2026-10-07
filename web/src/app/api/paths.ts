/**
 * `/competitions/<compId>[/<segment>…]` for `apiFetch`. Every segment is
 * URI-encoded: `compId` can come from an overlay URL, and a `/` or `..` in it
 * would otherwise reroute the request to another route of the same API.
 */
export const compPath = (compId: string, ...segments: string[]): string =>
  ['/competitions', ...[compId, ...segments].map(encodeURIComponent)].join('/');
