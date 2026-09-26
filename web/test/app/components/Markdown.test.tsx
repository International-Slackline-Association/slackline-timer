import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Markdown } from 'app/components/Markdown';
import { manualArticles, manualHref } from 'app/manual/manual';

/**
 * The manual's rendering contract. `manual.test.ts` checks the *source* tree
 * (frontmatter, the no-dev-links rule); this checks that what the source says
 * actually survives the markdown → MUI mapping — headings carry the anchor ids
 * the cross-page links target, GFM tables become real tables, and a
 * `./page.md` link comes out as a `/help` route rather than a dead file link.
 */

const renderMd = (markdown: string) =>
  render(
    <MemoryRouter>
      <Markdown resolveHref={manualHref}>{markdown}</Markdown>
    </MemoryRouter>,
  );

describe('Markdown', () => {
  it('gives headings the anchor id their cross-page links target', () => {
    renderMd('## The buzzers do nothing\n');
    expect(screen.getByText('The buzzers do nothing')).toHaveAttribute(
      'id',
      'the-buzzers-do-nothing',
    );
  });

  it('routes a manual link to /help and leaves an external one alone', () => {
    renderMd('[here](./troubleshooting.md#no-beeps) and [there](https://example.org)');
    expect(screen.getByRole('link', { name: 'here' })).toHaveAttribute(
      'href',
      '/help/troubleshooting#no-beeps',
    );
    expect(screen.getByRole('link', { name: 'there' })).toHaveAttribute(
      'href',
      'https://example.org',
    );
  });

  it('renders a GFM table', () => {
    renderMd('| Button | Does |\n| --- | --- |\n| Red | Stop lane 1 |\n');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Button' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Stop lane 1' })).toBeInTheDocument();
  });

  it('renders checklist boxes read-only — a tick here is never saved', () => {
    renderMd('- [ ] Competition created\n- [x] Athletes entered\n');
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });

  it.each(manualArticles.map((a) => [a.slug, a.body] as const))(
    'renders %s without throwing',
    (_slug, body) => {
      expect(() => renderMd(body)).not.toThrow();
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    },
  );
});
