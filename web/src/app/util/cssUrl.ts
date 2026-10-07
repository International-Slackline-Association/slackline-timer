/** `blob:` is the admin form's local preview of a just-picked photo (`URL.createObjectURL`). */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

/**
 * A CSS `url("…")` for a data-supplied URL, or undefined when it is not an
 * absolute http(s)/blob URL. Quoted with `"`, `\` and line breaks CSS-escaped,
 * so a `)`, quote or space in the URL can't end the value and inject CSS.
 */
export const cssUrl = (u: string | undefined): string | undefined => {
  if (!u) return undefined;
  let protocol: string;
  try {
    protocol = new URL(u).protocol;
  } catch {
    return undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(protocol)) return undefined;
  const escaped = u.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
  return `url("${escaped}")`;
};
