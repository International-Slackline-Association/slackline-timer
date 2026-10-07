import { render } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FreestylePreviewPage } from 'app/pages/Freestyle/PreviewPage';
import { FreestyleStreamTimer } from 'app/pages/Freestyle/StreamTimer';
import { FreestyleVenueAthletes } from 'app/pages/Freestyle/VenueAthletes';
import { SpeedlinePreviewPage } from 'app/pages/Speedline/PreviewPage';
import { SpeedlineStreamTimer } from 'app/pages/Speedline/StreamTimer';
import { StreamAthletesFreestyle } from 'app/pages/Stream/StreamAthletesFreestyle';
import { routeGround, SURFACE_GROUND, type DisplaySurface } from 'app/pages/Stream/overlayBg';

// Each display renders its variant as text, so a page's chosen ground is readable
// without booting its socket.
const { Variant } = vi.hoisted(() => ({
  Variant: ({ variant }: { variant: string }) => variant,
}));
vi.mock('app/pages/Speedline/SpeedlineTimerDisplay', () => ({ SpeedlineTimerDisplay: Variant }));
vi.mock('app/pages/Freestyle/FreestyleTimerDisplay', () => ({ FreestyleTimerDisplay: Variant }));
vi.mock('app/pages/Freestyle/FreestyleAthleteDisplay', () => ({
  FreestyleAthleteDisplay: Variant,
}));

/** The route each page is mounted on in `app/index.tsx`. */
const ROUTES: [string, FC][] = [
  ['/speedline/preview', SpeedlinePreviewPage],
  ['/freestyle/preview', FreestylePreviewPage],
  ['/freestyle/athletes', FreestyleVenueAthletes],
  ['/stream/timer', SpeedlineStreamTimer],
  ['/stream/timer-freestyle', FreestyleStreamTimer],
  ['/stream/athletes-freestyle', StreamAthletesFreestyle],
];

describe('display grounds', () => {
  it.each(ROUTES)('%s: the boundary holds the ground the page paints', (path, Page) => {
    const { container } = render(<Page />);
    const variant = container.textContent as DisplaySurface;
    expect(SURFACE_GROUND[variant]).toBe(routeGround(path));
  });

  it('keeps the StreamLayout overlays on the stream ground', () => {
    expect(routeGround('/stream/rankings/final/women')).toBe(SURFACE_GROUND.stream);
  });
});
