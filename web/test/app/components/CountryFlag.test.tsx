import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CountryFlag } from 'app/components/CountryFlag';

// Single source of truth for the demo roster's nations — shared with
// server/scripts/seedLocal.mjs, so a new seed country auto-tracks the assertion
// below instead of silently outrunning a hardcoded literal.
import seedRoster from '../../../../server/scripts/seedRoster.json';

describe('CountryFlag', () => {
  it('renders nothing for an empty code', () => {
    const { container } = render(<CountryFlag code={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('passes through an alpha-2 code (lowercased) to a flag-icons span', () => {
    const { container } = render(<CountryFlag code="US" />);
    const flag = container.querySelector('span.fi');
    expect(flag).toHaveClass('fi-us');
    expect(flag).toHaveAttribute('aria-label', 'US');
  });

  it('normalizes an alpha-3 code to alpha-2', () => {
    const { container } = render(<CountryFlag code="USA" />);
    expect(container.querySelector('span.fi')).toHaveClass('fi-us');
  });

  it('resolves IOC codes that diverge from ISO alpha-3', () => {
    // IOC -> expected flag-icons class. These differ from the ISO alpha-3
    // spelling, so they must hit the IOC table, not the ISO map.
    const cases: Record<string, string> = {
      GER: 'fi-de',
      SUI: 'fi-ch',
      NED: 'fi-nl',
      DEN: 'fi-dk',
      GRE: 'fi-gr',
      SLO: 'fi-si',
      CRO: 'fi-hr',
      RSA: 'fi-za',
      POR: 'fi-pt',
      // A home-nation entry flies the UK flag, never the England cross.
      ENG: 'fi-gb',
    };
    for (const [code, expected] of Object.entries(cases)) {
      const { container } = render(<CountryFlag code={code} />);
      expect(container.querySelector('span.fi'), code).toHaveClass(expected);
    }
  });

  it('normalizes a numeric-3 code to alpha-2', () => {
    const { container } = render(<CountryFlag code="840" />);
    expect(container.querySelector('span.fi')).toHaveClass('fi-us');
  });

  it('falls back to the raw code when it matches no known country', () => {
    const { container } = render(<CountryFlag code="ZZZ" />);
    expect(container.querySelector('span.fi')).toBeNull();
    expect(container.textContent).toBe('ZZZ');
  });

  it('renders the code once beside the flag with showCode', () => {
    const { container } = render(<CountryFlag code="GER" showCode />);
    expect(container.querySelector('span.fi')).toHaveClass('fi-de');
    // The code text appears exactly once (the old call sites printed it twice).
    expect(container.textContent).toBe('GER');
  });

  it('with showCode falls back to the code text once for an unknown country', () => {
    const { container } = render(<CountryFlag code="ZZZ" showCode />);
    expect(container.querySelector('span.fi')).toBeNull();
    expect(container.textContent).toBe('ZZZ');
  });

  it('resolves every athlete country code seeded by the server scripts', () => {
    // Codes come straight from the shared seed roster, so the demo must show a
    // flag (not a raw-text fallback) for every nation it ships — and a new seed
    // country is asserted automatically.
    const seedCodes = [...seedRoster.female, ...seedRoster.male].map((a) => a.country);
    expect(seedCodes.length).toBeGreaterThan(0);
    for (const code of seedCodes) {
      const { container } = render(<CountryFlag code={code} />);
      expect(container.querySelector('span.fi'), code).not.toBeNull();
    }
  });

  it('sizes the flag by height with a 4:3 width', () => {
    const { container } = render(<CountryFlag code="de" height={30} />);
    const flag = container.querySelector('span.fi') as HTMLElement;
    expect(flag.style.height).toBe('30px');
    expect(flag.style.width).toBe('40px');
  });
});
