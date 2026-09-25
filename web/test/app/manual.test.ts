import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manualArticle, manualArticles, manualHref } from 'app/manual/manual';
import { HANDSET_COLOUR_NOTE } from 'app/util/buzzer';
import { speedlineLocks, type SpeedlineLockInput } from 'app/util/speedlineLocks';

/**
 * The published manual's contract. `doc/user/` is the only doc tree the app
 * ships, and it is written for operators, not engineers — so the separation from
 * `doc/dev/` is enforced here rather than left to editorial discipline:
 *
 *  - a user doc may link ONLY to a sibling user doc (a `doc/dev/` link would be
 *    dead in the app — nothing outside `doc/user/` is published), and
 *  - every such link, anchor included, must actually resolve.
 *
 * The reverse direction is fine and unchecked: a dev doc may point readers at
 * the manual.
 */

const USER_DOCS = join(__dirname, '..', '..', '..', 'doc', 'user');

const files = readdirSync(USER_DOCS).filter((f) => f.endsWith('.md'));
const read = (file: string) => readFileSync(join(USER_DOCS, file), 'utf8');

/** `[text](target)` targets, ignoring image embeds. */
const linksIn = (markdown: string): string[] =>
  [...markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);

/** GitHub-compatible heading slug — mirrors `Markdown.tsx`'s `slugify`. */
const headingSlugs = (markdown: string): string[] =>
  [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, text]) =>
    text
      .replace(/[`*_]/g, '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-'),
  );

describe('published manual', () => {
  it('bundles every file in doc/user/', () => {
    expect(manualArticles.map((a) => a.slug).sort()).toEqual(
      files.map((f) => f.replace(/\.md$/, '')).sort(),
    );
    expect(manualArticles.length).toBeGreaterThan(0);
  });

  it.each(files)('%s declares complete frontmatter', (file) => {
    const article = manualArticle(file.replace(/\.md$/, ''))!;
    expect(article.title).not.toBe('');
    expect(article.audience).not.toBe('');
    expect(article.summary).not.toBe('');
    expect(Number.isSafeInteger(article.order)).toBe(true);
    // The frontmatter must not survive into the rendered body.
    expect(article.body.startsWith('---')).toBe(false);
  });

  it('orders the articles uniquely', () => {
    const orders = manualArticles.map((a) => a.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it.each(files)('%s never links out of the published tree', (file) => {
    const offenders = linksIn(read(file)).filter((href) => {
      if (/^(https?:|mailto:)/.test(href)) return false; // external, fine
      if (href.startsWith('#')) return false; // in-page anchor
      // Anything else must be a sibling `*.md` in this same directory.
      return !/^\.\/[a-z0-9-]+\.md(#[a-z0-9-]+)?$/.test(href);
    });
    expect(offenders).toEqual([]);
  });

  it.each(files)('%s resolves every internal link and anchor', (file) => {
    const unresolved = linksIn(read(file))
      .filter((href) => href.startsWith('./'))
      .filter((href) => {
        const [target, anchor] = href.slice(2).split('#');
        if (!files.includes(target)) return true;
        return Boolean(anchor) && !headingSlugs(read(target)).includes(anchor);
      });
    expect(unresolved).toEqual([]);
  });

  it('maps a manual link onto its /help route', () => {
    expect(manualHref('./troubleshooting.md')).toBe('/help/troubleshooting');
    expect(manualHref('./troubleshooting.md#the-buzzers-do-nothing')).toBe(
      '/help/troubleshooting#the-buzzers-do-nothing',
    );
    expect(manualHref('https://example.org')).toBe('https://example.org');
    expect(manualHref('#anchor')).toBe('#anchor');
  });
});

/**
 * One word per action across button, handset row and manual (FREESTYLE_BOARD_UX
 * rubric C15). Pinned because the failure is silent: a slice renames a control
 * and the manual goes on teaching last season's board.
 */
describe('freestyle judging page', () => {
  const body = read('freestyle-judging.md');

  it.each([
    'Take break',
    'End turn',
    'Start try',
    'ADVANCE',
    'Re-arm',
    'NOT SAVED',
    'Retry save',
    'Swap players',
    'Not recording',
    'Keep match',
  ])('speaks the board word %s', (word) => expect(body).toContain(word));

  // Athlete n is the ATHLETE vocabulary — the two whole-board controls are named
  // for the pair of clocks they re-arm, on screen and here. Pinned because the
  // batch's "never Lane" rule reads as a blanket ban, and renaming these would
  // split the manual from the labels it teaches.
  it.each(['Set both lanes', 'Reset lanes for the next match'])(
    'keeps the whole-board control label %s',
    (label) => expect(body).toContain(label),
  );

  it.each(['Break / end turn', 'Break-end turn', 'New entry', 'click that chip'])(
    'no longer describes the old board (%s)',
    (gone) => expect(body).not.toContain(gone),
  );
});

/**
 * The Speedline board's blockers, same rule (C15): the console prints them, so
 * the page that teaches them has to be reading the same map. A slice rewording
 * a lock and leaving the manual behind fails here rather than in a tent.
 */
describe('speed highline timing page', () => {
  // Prose wraps, blockers do not: compare against the unwrapped page.
  const body = read('speedline-timing.md').replace(/\s+/g, ' ');

  const idle = { kind: 'idle' } as const;
  const boards: SpeedlineLockInput[] = [
    { connected: true, signalPhase: 2, aborted: false, now: 0, laneState: { 1: idle, 2: idle } },
    // The two endings of a start sequence — both -1 on the wire, both waiting
    // on the same Reset, and worded apart so the board never blames an abort
    // that never happened.
    { connected: true, signalPhase: -1, aborted: true, now: 0, laneState: { 1: idle, 2: idle } },
    { connected: true, signalPhase: -1, aborted: false, now: 0, laneState: { 1: idle, 2: idle } },
    {
      connected: true,
      signalPhase: 0,
      aborted: false,
      now: 0,
      laneState: { 1: { kind: 'running', startTime: 1 }, 2: idle },
    },
    // A resolved run, for the Resume the manual sends the operator to Void from.
    {
      connected: true,
      signalPhase: -1,
      aborted: false,
      now: 1_000_000,
      laneState: {
        1: { kind: 'finished', startTime: 1, stopTime: 5_000, elapsedMs: 4_999 },
        2: idle,
      },
    },
  ];
  const reasons = [
    ...new Set(
      boards.flatMap((board) => {
        const locks = speedlineLocks(board);
        return [locks.start, locks.abort, locks.reset, locks.stop[2], locks.resume[1]];
      }),
    ),
  ].filter((reason): reason is string => reason !== null);

  it.each(reasons)('teaches the blocker %s', (reason) => expect(body).toContain(reason));

  it('states the handset colour divergence the buzzer sheet shows', () =>
    expect(body).toContain(HANDSET_COLOUR_NOTE));
});
