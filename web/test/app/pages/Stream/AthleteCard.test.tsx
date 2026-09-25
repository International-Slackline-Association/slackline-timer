import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Athlete } from 'app/types';
import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { colors, overlayTypeFloor } from 'app/theme/tokens';

/** Resolve a hex token to the `rgb(...)` form jsdom reports for `color`. */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const athlete = (over: Partial<Athlete> = {}): Athlete => ({
  athleteId: 'a1',
  compId: 'c1',
  name: 'Taylor St. Germain',
  firstName: 'Taylor',
  lastName: 'St. Germain',
  birthDate: '1990-01-01',
  country: 'CAN',
  gender: 'female',
  photoUrl: 'https://cdn.example/taylor.jpg',
  ...over,
});

describe('AthleteCard (LAAX athlete-card art)', () => {
  it('splits the name into a bold given name over a light family name', () => {
    render(<AthleteCard athlete={athlete()} />);

    const first = screen.getByText('Taylor');
    const last = screen.getByText('St. Germain');
    expect(window.getComputedStyle(first).fontWeight).toBe('700');
    expect(window.getComputedStyle(last).fontWeight).toBe('300');
  });

  it('sizes the family name to the masters 1.25 cap-height ratio under the given name', () => {
    // The card masters set given:family = 44.6:35.62 ≈ 1.25 (34cqh over 27.2cqh) —
    // near-equal cap heights, kept apart by the 700/300 weight split, not size.
    render(<AthleteCard athlete={athlete()} />);
    expect(window.getComputedStyle(screen.getByText('Taylor')).fontSize).toBe('34cqh');
    expect(window.getComputedStyle(screen.getByText('St. Germain')).fontSize).toBe('27.2cqh');
  });

  it('masks the name plate top edge into a concave-upward arc (not a straight slant)', () => {
    // The signature LAAX cut is a shallow arc, applied as a radial-gradient mask;
    // the former straight-diagonal clip-path must be gone.
    const { container } = render(<AthleteCard athlete={athlete()} />);
    const band = container.querySelector('[data-band]') as HTMLElement;
    const style = window.getComputedStyle(band);
    expect(style.maskImage || style.webkitMaskImage).toContain('radial-gradient');
    expect(style.clipPath).not.toContain('polygon');
  });

  it('renders the portrait in black & white (grayscale filter)', () => {
    render(<AthleteCard athlete={athlete()} />);
    const photo = screen.getByTestId('athlete-card-photo');
    expect(window.getComputedStyle(photo).filter).toContain('grayscale');
    expect(window.getComputedStyle(photo).backgroundImage).toContain('taylor.jpg');
  });

  it('renders the name in the overlay name-ink colour (first-class overlay token)', () => {
    render(<AthleteCard athlete={athlete()} />);
    const first = window.getComputedStyle(screen.getByText('Taylor'));
    const last = window.getComputedStyle(screen.getByText('St. Germain'));
    expect(first.color).toBe(rgb(colors.overlay.nameInk));
    expect(last.color).toBe(rgb(colors.overlay.nameInk));
  });

  it('renders the country flag strip at the card foot', () => {
    render(<AthleteCard athlete={athlete()} />);
    expect(screen.getByTestId('athlete-card-flag-strip')).toBeInTheDocument();
  });

  it('draws the 2px near-black divider rule above the flag band (master fidelity)', () => {
    // The masters draw a near-black rule at 93.9%, between the white plate foot
    // and the flag band. It sits on the flag strip's top edge, in the name ink.
    const { getByTestId } = render(<AthleteCard athlete={athlete()} />);
    const divider = getByTestId('athlete-card-divider');
    const style = window.getComputedStyle(divider);
    expect(style.bottom).toBe('6%'); // FLAG_STRIP_H — flush on top of the flag band
    expect(style.backgroundColor).toBe(rgb(colors.overlay.nameInk));
  });

  it('shows the question-mark placeholder (no TBD text, no white band) when no athlete is bound', () => {
    const { container } = render(<AthleteCard />);
    expect(screen.getByTestId('athlete-card-unknown')).toBeInTheDocument();
    // The former "TBD" text and the white name band are both dropped, so the
    // undecided card is just the translucent plate under the mark.
    expect(screen.queryByText('TBD')).not.toBeInTheDocument();
    expect(container.querySelector('[data-band]')).toBeNull();
  });

  it('leaves the TBD slot photo region transparent (translucent plate shows through)', () => {
    // An unbound (TBD) bracket/VS slot must let the Plate's translucent
    // overlay.plate fill show through — a solid-white paint here reads as an
    // opaque filled box instead of the reference's translucent grey empty slot.
    render(<AthleteCard />);
    const photo = screen.getByTestId('athlete-card-photo');
    expect(window.getComputedStyle(photo).backgroundColor).not.toBe(
      rgb(colors.overlay.plateFilled),
    );
  });

  it('paints a solid initials plate for a photoless BOUND athlete (not keyed-out)', () => {
    // A present athlete with no photo still gets the opaque initials plate so the
    // card reads as an intentional name plate rather than a void on chroma.
    render(<AthleteCard athlete={athlete({ photoUrl: undefined })} />);
    const photo = screen.getByTestId('athlete-card-photo');
    expect(window.getComputedStyle(photo).backgroundColor).toBe(rgb(colors.overlay.plateFilled));
  });

  it('scopes the name block to its own container so cqh resolves against the band', () => {
    // The name region carries its own container context; without it the type
    // (sized in cqh of the whole card) rides up under the slant and shears.
    render(<AthleteCard athlete={athlete()} />);
    const nameRegion = screen.getByTestId('athlete-card-name');
    const style = window.getComputedStyle(nameRegion);
    expect(style.containerType).toBe('size');
    expect(style.overflow).toBe('hidden');
  });

  it('renders an optional result numeral in the monospace face', () => {
    render(<AthleteCard athlete={athlete()} result="1:23.45" />);
    const result = window.getComputedStyle(screen.getByText('1:23.45'));
    expect(result.fontFamily).toContain('JetBrains Mono');
  });

  it('omits the result numeral entirely when no result is passed (no dash placeholder)', () => {
    render(<AthleteCard athlete={athlete()} />);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('paints a WINNER tag in the green display caps when winnerTag is set', () => {
    render(<AthleteCard athlete={athlete()} isWinner winnerTag />);
    const tag = screen.getByTestId('athlete-card-winner-tag');
    const style = window.getComputedStyle(tag);
    // The same green display language WinnerOverlay's banner uses.
    expect(style.color).toBe(rgb(colors.race.go));
    // 700, not 800: Oswald ships no 800, so an 800 declaration would silently
    // resolve to the 700 face — pin the weight that actually exists.
    expect(style.fontWeight).toBe('700');
    expect(style.textTransform).toBe('uppercase');
  });

  it('shows no WINNER tag by default (opt-in only)', () => {
    render(<AthleteCard athlete={athlete()} isWinner />);
    expect(screen.queryByTestId('athlete-card-winner-tag')).not.toBeInTheDocument();
  });

  it('narrow mode shows a single meaningful fragment (shortName) instead of first+last', () => {
    // The tiny profile quarter boxes can't fit "MAXIMILIAN STEINHAUSER"; rather
    // than degrade to "M…" prefer the condensed label so the text stays legible.
    render(
      <AthleteCard
        athlete={athlete({
          firstName: 'Maximilian',
          lastName: 'Steinhauser',
          shortName: 'M. STEIN',
        })}
        narrow
      />,
    );
    expect(screen.getByTestId('athlete-card-name')).toHaveTextContent('M. STEIN');
    expect(screen.queryByText('Maximilian')).not.toBeInTheDocument();
    expect(screen.queryByText('Steinhauser')).not.toBeInTheDocument();
  });

  it('narrow mode falls back to lastName when no shortName', () => {
    render(
      <AthleteCard
        athlete={athlete({
          firstName: 'Maximilian',
          lastName: 'Steinhauser',
          shortName: undefined,
        })}
        narrow
      />,
    );
    expect(screen.getByText('Steinhauser')).toBeInTheDocument();
    expect(screen.queryByText('Maximilian')).not.toBeInTheDocument();
  });

  it('leaves a short name at full size (no downscale)', () => {
    // jsdom reports 0 for both widths (no layout), so the shrink-to-fit stays 1.
    render(<AthleteCard athlete={athlete()} />);
    expect(window.getComputedStyle(screen.getByTestId('athlete-card-name-fit')).transform).toBe(
      'scale(1)',
    );
  });

  it('shrinks a longish family name to fit instead of ellipsizing it (goal g3)', () => {
    // The stacked name sizes in a fixed cqh with noWrap, so a long family name
    // used to ellipsize on the full photo card. jsdom has no layout — simulate a
    // name whose natural width (600) overflows its slot (300); the fit box should
    // scale to 300/600 = 0.5 rather than clip.
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    try {
      render(
        <AthleteCard athlete={athlete({ firstName: 'Sebastian', lastName: 'Vandenberghe' })} />,
      );
      expect(window.getComputedStyle(screen.getByTestId('athlete-card-name-fit')).transform).toBe(
        'scale(0.5)',
      );
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  it('holds the name slot at full height when a result rides under it', () => {
    // The slot used to be a shrinkable flex child, so the result numeral took
    // its height and the 27.2cqh family name was cut at ~60% glyph height on
    // every profile-rankings card. It must not yield; name + result scale
    // together inside the one measured wrapper instead.
    render(<AthleteCard athlete={athlete()} result="31.0" sourceTag="FINAL" />);
    expect(window.getComputedStyle(screen.getByTestId('athlete-card-name-slot')).flexShrink).toBe(
      '0',
    );
    const fitted = within(screen.getByTestId('athlete-card-name-fit'));
    expect(fitted.getByText('Taylor')).toBeInTheDocument();
    expect(fitted.getByText('St. Germain')).toBeInTheDocument();
    expect(fitted.getByText('31.0')).toBeInTheDocument();
    expect(fitted.getByTestId('athlete-card-source-tag')).toBeInTheDocument();
  });

  it('shrinks the whole stack when it outgrows the band HEIGHT, not just the width', () => {
    // jsdom has no layout — simulate a name+result stack 250 tall in a 100-tall
    // band; the fit takes the tighter of the two axes (100/250 = 0.4).
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(100);
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(250);
    try {
      render(<AthleteCard athlete={athlete()} result="31.0" />);
      expect(window.getComputedStyle(screen.getByTestId('athlete-card-name-fit')).transform).toBe(
        'scale(0.4)',
      );
    } finally {
      clientHeight.mockRestore();
      scrollHeight.mockRestore();
    }
  });

  it('floors the narrow name at the 1080p legibility px floor (goal g3)', () => {
    // 30cqh resolves against the ~26%-tall name band, so the ~171px quarter box
    // dropped the narrow name to ~13px. max(cqh, floor) pins the px floor.
    // (jsdom 29 drops max() from computed fontSize, so assert the injected rule.)
    // The floor arrives through the var channel PlayoffBracket overrides per
    // measured canvas; the token is its fallback, so a standalone card is unchanged.
    render(<AthleteCard athlete={athlete({ shortName: 'M. STEIN' })} narrow />);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain(`max(30cqh, var(--overlay-type-floor, ${overlayTypeFloor}))`);
  });

  it('floors the result numeral at the legibility px floor on small cards (goal g3)', () => {
    // The smallest profile-ranking card dropped the 22cqh result numeral to ~13px.
    render(<AthleteCard athlete={athlete()} result="31.0" />);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain(`max(22cqh, var(--overlay-type-floor, ${overlayTypeFloor}))`);
  });

  it('leaves accent headroom on the narrow name (line-height ≥ 1, not the old 0.95)', () => {
    // The tiny quarter box clipped uppercase accents under overflow:hidden with a
    // sub-1 line-height (overlay-typography-polish).
    render(<AthleteCard athlete={athlete({ shortName: 'M. STEIN' })} narrow />);
    expect(window.getComputedStyle(screen.getByText('M. STEIN')).lineHeight).toBe('1.1');
  });

  it('frames the flag band with a hairline keyline (low-contrast flag on the white foot)', () => {
    // A white-field flag (Japan) is otherwise indistinguishable from the white
    // plate foot; a near-black inset keyline gives every flag a crisp edge
    // (overlay-typography-polish).
    render(<AthleteCard athlete={athlete()} />);
    const keyline = window.getComputedStyle(screen.getByTestId('athlete-card-flag-keyline'));
    expect(keyline.boxShadow).toContain('inset');
    expect(keyline.boxShadow).toMatch(/#231f20|rgb\(35, ?31, ?32\)/);
  });

  it('keeps the bold-first/light-last split in the default (wide) mode', () => {
    render(<AthleteCard athlete={athlete({ shortName: 'T. ST.G' })} />);
    expect(screen.getByText('Taylor')).toBeInTheDocument();
    expect(screen.getByText('St. Germain')).toBeInTheDocument();
    expect(screen.queryByText('T. ST.G')).not.toBeInTheDocument();
  });
});
