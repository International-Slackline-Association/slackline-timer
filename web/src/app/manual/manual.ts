/**
 * The user-facing manual, bundled from `doc/user/*.md`.
 *
 * The manual is authored as markdown in the repo (one source of truth, reviewed
 * like any other file) and published *by the app* — `/help` renders these very
 * files, so a doc edit ships with the next deploy and there is no second copy to
 * drift. Nothing else in the repo is bundled this way: `doc/dev/` is
 * engineering-facing and deliberately stays out of the build.
 *
 * The one rule the tree carries (enforced by `test/app/manual.test.ts`): a user
 * doc may only link to a sibling user doc. A link into `doc/dev/` would render
 * as a dead link in the app, since nothing outside this glob is published.
 */

/** Raw file contents, keyed by the source path. Inlined at build time. */
const sources = import.meta.glob('../../../../doc/user/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface ManualArticle {
  /** URL segment under `/help`, from the filename. */
  slug: string;
  title: string;
  /** Who the page is written for — shown on the index card. */
  audience: string;
  /** One-line description for the index. */
  summary: string;
  /** Index ordering; the manual reads top-to-bottom. */
  order: number;
  /** Markdown body, frontmatter stripped. */
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Minimal YAML-frontmatter reader: flat `key: value` pairs only, which is all
 * the manual's header uses. Deliberately not a YAML dependency — the shape is
 * fixed and asserted by the manual test.
 */
const parseFrontmatter = (raw: string): { meta: Record<string, string>; body: string } => {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    meta[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: raw.slice(match[0].length) };
};

const slugOf = (path: string): string => path.split('/').pop()!.replace(/\.md$/, '');

export const manualArticles: readonly ManualArticle[] = Object.entries(sources)
  .map(([path, raw]) => {
    const { meta, body } = parseFrontmatter(raw);
    const slug = slugOf(path);
    return {
      slug,
      title: meta.title ?? slug,
      audience: meta.audience ?? '',
      summary: meta.summary ?? '',
      order: Number(meta.order ?? Number.MAX_SAFE_INTEGER),
      body,
    };
  })
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

export const manualArticle = (slug: string | undefined): ManualArticle | undefined =>
  manualArticles.find((a) => a.slug === slug);

/**
 * Rewrite a manual-relative markdown link (`./troubleshooting.md#anchor`) onto
 * its `/help` route. Anything else — an external URL, an in-page anchor — is
 * returned unchanged for the renderer to treat as-is.
 */
export const manualHref = (href: string): string => {
  const match = /^\.?\/?([a-z0-9-]+)\.md(#.*)?$/i.exec(href);
  return match ? `/help/${match[1]}${match[2] ?? ''}` : href;
};
