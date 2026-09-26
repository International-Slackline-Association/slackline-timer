import { Stack, Typography } from '@mui/material';

import { RaceButton } from 'app/components/RaceButton';
import { liveCaption } from 'app/theme/tokens';
import { apiErrorMessage } from 'app/util/apiError';
import type { MatchWinner } from 'app/util/scoreInput';

/**
 * The match-winner line under the run board. `derivedWinner`: an athlete id,
 * '' (an explicit no-winner — tie / both DNF), or null (unresolved). Shared by
 * the Speedline and Freestyle recording consoles; the caller owns the
 * match-selected guard.
 *
 * The freestyle board adds the three §4.9 optionals: WHERE the id came from
 * (a fresh derivation vs the winner already on the Match — the two are
 * different claims and the operator has to be able to tell them apart), what
 * the line is still waiting for while nothing is resolved, and the failed
 * Match PUT with its retry. The write lands here rather than in a panel-level
 * alert because this line is the value that write stores.
 */
export const MatchWinnerLine = ({
  derivedWinner,
  athleteName,
  source,
  awaiting,
  update,
}: {
  derivedWinner: string | null;
  athleteName: (id?: string) => string;
  source?: MatchWinner['source'];
  /** e.g. `waits for Athlete 2 save`; nothing renders without it. */
  awaiting?: string | null;
  /** The winner PUT that failed, and the action that re-runs it. */
  update?: { error: unknown; onRetry: () => void } | null;
}) => {
  const failed = update?.error != null;
  if (derivedWinner === null && !awaiting && !failed) return null;
  const name = derivedWinner ? athleteName(derivedWinner) : 'no winner (tie / both DNF)';
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {derivedWinner === null ? (
          <>Winner: — {awaiting}</>
        ) : source === 'persisted' ? (
          <>
            Recorded winner (earlier entry): <strong>{name}</strong>
          </>
        ) : (
          <>
            Match winner: <strong>{name}</strong>
            {source === 'derived' && ' — derived from both saved scores'}
          </>
        )}
      </Typography>
      {failed && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" sx={{ ...liveCaption, color: 'error.dark' }}>
            Match not updated: {apiErrorMessage(update?.error)} (timing is unaffected)
          </Typography>
          <RaceButton
            tone="neutral"
            aria-label="Retry the match update"
            onClick={() => update?.onRetry()}
          >
            Retry
          </RaceButton>
        </Stack>
      )}
    </Stack>
  );
};
