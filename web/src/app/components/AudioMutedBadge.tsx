import { CornerBadge } from 'app/components/CornerBadge';

/**
 * Corner "audio muted" indicator for the projector display surface, driven off
 * `useSignalAudio().audioBlocked`. It self-clears on the first click/keypress
 * anywhere (the unlock gesture installed by the hook).
 *
 * Projector-only by construction: its hosts render it only on the `projector`
 * variant. Unlike ConnectionLostBadge it deliberately paints over chroma-keyed
 * grounds too (no `useChromaSuppressed` guard): the muted state can only be
 * fixed by a gesture on the tab itself, so on the keyed projector rig — exactly
 * the surface whose beeps feed the venue PA — hiding it would recreate the
 * silent no-beep failure it exists to surface. The broadcast overlay composites
 * over live video where the tab audio is irrelevant, so its hosts suppress it
 * there. It appears at setup time and is gone after the crew's first click.
 */
export const AudioMutedBadge = ({ blocked }: { blocked: boolean }) => {
  if (!blocked) {
    return null;
  }

  return (
    <CornerBadge
      corner="left"
      tone="warning"
      label="Audio muted — click to enable"
      testId="audio-muted"
    />
  );
};
