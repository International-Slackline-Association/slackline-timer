import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useAthletes } from 'app/api/athletes';
import { useMatches } from 'app/api/matches';
import { useRankings } from 'app/api/rankings';
import { usePersistentReadToken, useRevokeReadTokens } from 'app/api/readTokens';
import { BoardConfirmDialog } from 'app/components/BoardConfirmDialog';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { fieldWidths } from 'app/theme/tokens';
import {
  DISCIPLINE,
  GENDERS,
  MATCH_ROUNDS,
  type Discipline,
  type Gender,
  type MatchRound,
} from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';
import { genderLabel } from 'app/util/gender';
import { displayRoundName, roundLabel } from 'app/util/rounds';
import { deriveStreamStatus, type StreamStatus } from 'app/pages/Stream/streamStatus';

/**
 * `/admin/overlays` — mint an event read token and hand the operator ready-made
 * `/stream/*` overlay URLs to paste into OBS/H2R. The token is read-only,
 * competition-scoped, and expires with the event; "Revoke" bumps the
 * competition's tokenVersion so every outstanding link dies at once.
 */
export const OverlaysPage = () => (
  <SelectCompetitionGate title="Streaming overlays">
    {(compId) => <OverlaysManager compId={compId} />}
  </SelectCompetitionGate>
);

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '');

const disciplineLabel = (discipline: Discipline) =>
  discipline === 'speed' ? 'Speed' : 'Freestyle';

/** Speed | Freestyle side by side from `lg`, so both Live groups open the page. */
const DISCIPLINE_COLUMNS = { xs: '1fr', lg: '1fr 1fr' } as const;

/**
 * From `lg` each discipline section is a subgrid over three shared row tracks
 * (heading, Live, Round-pinned): the taller Live group sets the row for both
 * columns, so the Round-pinned headings share a line. Stacked, it is inert.
 */
const DISCIPLINE_SECTION_ROWS = {
  display: { lg: 'grid' },
  gridTemplateRows: { lg: 'subgrid' },
  gridRow: { lg: 'span 3' },
} as const;

/** `pinned`: built from the Round/Gender pickers rather than following the board. */
interface OverlayLink {
  label: string;
  url: string;
  pinned: boolean;
}

/**
 * Overlay URLs for one discipline. The read token is competition-scoped, so the
 * same token serves both disciplines — only the appended `&discipline=` differs
 * (omitted for speed, the overlay default). `bgSuffix` is the shared background
 * mode, threaded onto every minted link so the operator copies the right one
 * for their rig.
 */
const overlayLinks = (
  compId: string,
  token: string,
  discipline: Discipline,
  round: MatchRound,
  gender: Gender,
  bgSuffix: string,
): OverlayLink[] => {
  const suffix = `?compId=${compId}&token=${token}${
    discipline === 'speed' ? '' : `&discipline=${discipline}`
  }${bgSuffix}`;
  // The timer pages join the relay room by `sessionId` and take their
  // discipline from the path, so they carry neither `compId` nor `&discipline=`.
  const timerSuffix = `?sessionId=${compId}&token=${token}${bgSuffix}`;
  return [
    discipline === 'speed'
      ? {
          label: 'Race timer (Speed)',
          url: `${origin()}/stream/timer${timerSuffix}`,
          pinned: false,
        }
      : {
          label: 'Run clock (Freestyle)',
          url: `${origin()}/stream/timer-freestyle${timerSuffix}`,
          pinned: false,
        },
    // Full-screen audience-facing athlete display (freestyle only): quali
    // single-hero / battle split-screen, switching on the board's relayed mode.
    ...(discipline === 'freestyle'
      ? [
          {
            label: 'Athlete display',
            url: `${origin()}/stream/athletes-freestyle${suffix}`,
            pinned: false,
          },
        ]
      : []),
    {
      label: 'Rankings',
      url: `${origin()}/stream/rankings/${round}/${gender}${suffix}`,
      pinned: true,
    },
    // The freestyle judged score table: the round's ranked field with the full
    // component breakdown. Freestyle only — there is nothing to break down on
    // the speed plane.
    ...(discipline === 'freestyle'
      ? [
          {
            label: 'Score card (judged table)',
            url: `${origin()}/stream/scorecard/${round}/${gender}${suffix}`,
            pinned: true,
          },
        ]
      : []),
    // The top-4 profile cut of the ranking: portrait athlete cards instead of
    // name plates, same data path. Minted alongside so operators pick the
    // layout in-UI, like the bracket variants.
    {
      label: 'Rankings (top-4 profiles)',
      url: `${origin()}/stream/rankings/${round}/${gender}${suffix}&variant=profile`,
      pinned: true,
    },
    // Final overall standings (rule G3): the `overall` pseudo-round merging
    // bracket outcomes with quali. Round-independent but gender-pinned.
    {
      label: 'Final standings',
      url: `${origin()}/stream/rankings/overall/${gender}${suffix}`,
      pinned: true,
    },
    {
      label: 'Head-to-head (VS)',
      url: `${origin()}/stream/vs/${round}/${gender}${suffix}`,
      pinned: true,
    },
    // Round-following VS: one source that tracks the board's selected match
    // across every round of this gender+discipline (quarters → final), so the
    // operator never swaps the OBS link. Live, though the Gender picker still
    // chooses the division it follows.
    {
      label: 'Head-to-head (VS, live — follows all rounds)',
      url: `${origin()}/stream/vs-live/${gender}${suffix}`,
      pinned: false,
    },
    // Match winner (board-driven): the decided match's winner card. Follows the
    // same match precedence as VS; blank until the match has a winnerId.
    {
      label: 'Match winner',
      url: `${origin()}/stream/winner/${round}/${gender}${suffix}`,
      pinned: true,
    },
    // Best-of-3 rounds summary (speed only): accumulates a winner card per won
    // run from the board's live `runWins` tally. Blank until the first run lands.
    ...(discipline === 'speed'
      ? [
          {
            label: 'Rounds summary (best of 3)',
            url: `${origin()}/stream/rounds-summary/${round}/${gender}${suffix}`,
            pinned: true,
          },
        ]
      : []),
    // Single-competitor (live, board-driven): one card per lane/player, following
    // the control board's selection. Result follows the board's discipline; the
    // appended `&discipline=` here just keeps the URL self-describing.
    { label: 'SVO (live, side 1)', url: `${origin()}/stream/svo-live/1${suffix}`, pinned: false },
    { label: 'SVO (live, side 2)', url: `${origin()}/stream/svo-live/2${suffix}`, pinned: false },
    // Both bracket layouts (the LAAX reference art): the photo `profile` tree
    // (the overlay default, left implicit) and the single-direction `name`
    // tree. Mint both so operators pick the layout in-UI rather than
    // hand-editing `&variant=`.
    {
      label: 'Bracket (photos)',
      url: `${origin()}/stream/brackets/${gender}${suffix}`,
      pinned: true,
    },
    {
      label: 'Bracket (names)',
      url: `${origin()}/stream/brackets/${gender}${suffix}&variant=name`,
      pinned: true,
    },
  ];
};

const OverlaysManager = ({ compId }: { compId: string }) => {
  // The overlay token is reused from localStorage across visits (through the
  // first half of its lifetime), so the links reappear without re-minting.
  const overlayToken = usePersistentReadToken(compId);
  const revokeTokens = useRevokeReadTokens(compId);
  const [round, setRound] = useState<MatchRound>('final');
  const [gender, setGender] = useState<Gender>('male');
  // Background mode appended to every minted link: '' (transparent, the default
  // for OBS/vMix/NDI alpha), '&bg=key' (magenta chroma for hardware keyers), or
  // '&bg=h2r' (transparent + the measured color adaptation for the H2R
  // #EC008C keyed chain). See doc/dev/broadcast-overlays.md.
  const [bgSuffix, setBgSuffix] = useState<'' | '&bg=key' | '&bg=h2r'>('');
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const token = overlayToken.token;
  const expiresAt = overlayToken.expiresAt;

  const revokeAll = () => {
    setConfirmingRevoke(false);
    // Revoking bumps the tokenVersion, so the cached token is now dead — drop
    // it too, or the page would keep serving a broken link.
    revokeTokens.mutate(undefined, { onSuccess: overlayToken.clear });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Streaming overlays
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Generate a read-only link for OBS/H2R. The link works until the event ends; revoke to kill
        all outstanding links immediately.
      </Typography>

      <Stack direction="row" useFlexGap sx={{ mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          onClick={() => overlayToken.generate()}
          disabled={overlayToken.isPending}
        >
          {token ? 'Regenerate overlay links' : 'Generate overlay links'}
        </Button>
        {/* Enabled with no token cached here: links minted on another machine
            still need revoking. */}
        <Button
          color="error"
          variant="outlined"
          onClick={() => setConfirmingRevoke(true)}
          disabled={revokeTokens.isPending}
          sx={{ ml: 'auto' }}
        >
          Revoke all links
        </Button>
      </Stack>
      <BoardConfirmDialog
        open={confirmingRevoke}
        titleId="revoke-links-title"
        title="Revoke all overlay links?"
        body="Every OBS, H2R and Companion link for this competition stops working immediately. You will need to generate new links and paste them into every source again."
        confirmLabel="Revoke all links"
        safeAnswer="Keep links"
        onConfirm={revokeAll}
        onCancel={() => setConfirmingRevoke(false)}
      />

      {overlayToken.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorMessage(overlayToken.error)}
        </Alert>
      )}
      {revokeTokens.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorMessage(revokeTokens.error)}
        </Alert>
      )}
      {revokeTokens.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          All overlay links revoked. Generate a new one to continue streaming.
        </Alert>
      )}

      {token && (
        <Box>
          <Stack
            direction="row"
            useFlexGap
            sx={{ mb: 1, gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <SelectField
              label="Round"
              value={round}
              onChange={(e) => setRound(e.target.value as MatchRound)}
              sx={{ minWidth: fieldWidths.field }}
              options={enumOptions(MATCH_ROUNDS, roundLabel)}
            />
            <SelectField
              label="Gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender)}
              sx={{ minWidth: fieldWidths.compact }}
              options={enumOptions(GENDERS, genderLabel)}
            />
            <SelectField
              label="Background"
              value={bgSuffix}
              onChange={(e) => setBgSuffix(e.target.value as '' | '&bg=key' | '&bg=h2r')}
              sx={{ minWidth: fieldWidths.wide }}
              options={[
                { value: '', label: 'Transparent (OBS/vMix/NDI)' },
                { value: '&bg=key', label: 'Chroma key — magenta' },
                { value: '&bg=h2r', label: 'Transparent, color-adapted (H2R)' },
              ]}
            />
            {expiresAt != null && (
              <Typography variant="body2" color="text.secondary">
                Expires {new Date(expiresAt).toLocaleString()}
              </Typography>
            )}
          </Stack>
          <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 2 }}>
            Round and Gender set the round-pinned links and the feed status; Gender also picks the
            division the live VS link follows. Background applies to every link.
          </Typography>
          <OverlayStatusPanel compId={compId} round={round} gender={gender} />
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: DISCIPLINE_COLUMNS, columnGap: 3 }}>
            {DISCIPLINE.map((discipline) => (
              <DisciplineLinks
                key={discipline}
                compId={compId}
                token={token}
                discipline={discipline}
                round={round}
                gender={gender}
                bgSuffix={bgSuffix}
              />
            ))}
          </Box>
          <CombinedLinks compId={compId} token={token} bgSuffix={bgSuffix} />
          <SvoAthleteLink compId={compId} token={token} bgSuffix={bgSuffix} />
          <H2rBridgeLink compId={compId} token={token} />
        </Box>
      )}
    </Container>
  );
};

interface DisciplineLinksProps {
  compId: string;
  token: string;
  discipline: Discipline;
  round: MatchRound;
  gender: Gender;
  bgSuffix: string;
}

/**
 * One discipline's links, split by what drives them: the Live group (paste
 * once, follows the board) leads, so it is never below a scroll of
 * round-pinned links that go stale as soon as the pickers move.
 */
const DisciplineLinks = (props: DisciplineLinksProps) => {
  const { compId, token, discipline, round, gender, bgSuffix } = props;
  const links = overlayLinks(compId, token, discipline, round, gender, bgSuffix);
  const headingId = `overlays-${discipline}`;
  const renderLinks = (pinned: boolean) =>
    links
      .filter((link) => link.pinned === pinned)
      .map((link) => (
        <CopyableUrl key={`${discipline}-${link.label}`} label={link.label} url={link.url} />
      ));

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{ mb: 3, minWidth: 0, ...DISCIPLINE_SECTION_ROWS }}
    >
      <Typography id={headingId} variant="h6" sx={{ mb: 1 }}>
        {disciplineLabel(discipline)}
      </Typography>
      <LinkGroup
        id={`${headingId}-live`}
        title="Live — load once (follows the board)"
        caption="Paste these into OBS once; they follow the control board through every round."
      >
        {renderLinks(false)}
      </LinkGroup>
      <LinkGroup
        id={`${headingId}-pinned`}
        title="Round-pinned — uses the Round/Gender pickers"
        caption={`Built for ${roundLabel(round)} · ${genderLabel(gender)}; copy again after changing the pickers.`}
      >
        {renderLinks(true)}
        <PerMatchVsLinks {...props} />
      </LinkGroup>
    </Box>
  );
};

const LinkGroup = ({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption: string;
  children: ReactNode;
}) => (
  <Box component="section" aria-labelledby={id} sx={{ mb: 2 }}>
    <Typography id={id} variant="subtitle2">
      {title}
    </Typography>
    <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 1.5 }}>
      {caption}
    </Typography>
    <Stack spacing={2}>{children}</Stack>
  </Box>
);

/**
 * Combined-title (rule G2) ranking links — cross-discipline by definition, so
 * they live once in a shared section (no `&discipline=`) and are
 * round-independent; only the gender splits the board. One link per gender.
 */
const CombinedLinks = ({
  compId,
  token,
  bgSuffix,
}: {
  compId: string;
  token: string;
  bgSuffix: string;
}) => (
  <Box sx={{ mb: 3 }}>
    <Typography variant="h6" sx={{ mb: 1 }}>
      Combined (speed + freestyle)
    </Typography>
    <Stack spacing={2}>
      {GENDERS.map((g) => (
        <CopyableUrl
          key={`combined-${g}`}
          label={`Combined ranking (${genderLabel(g)})`}
          url={`${origin()}/stream/rankings/combined/${g}?compId=${compId}&token=${token}${bgSuffix}`}
        />
      ))}
    </Stack>
  </Box>
);

/**
 * Single-competitor (SVO-A) identity card — discipline-agnostic, so it lives
 * once (not per discipline). The operator picks an athlete; the link carries
 * only `athleteId` + the comp-scoped read token. No discipline param: the card
 * is pure identity (photo + flag + name), no round/result.
 */
const SvoAthleteLink = ({
  compId,
  token,
  bgSuffix,
}: {
  compId: string;
  token: string;
  bgSuffix: string;
}) => {
  const athletes = useAthletes(compId);
  const roster = (athletes.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const [athleteId, setAthleteId] = useState('');

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Single competitor (SVO)
      </Typography>
      <Stack spacing={2}>
        <SelectField
          label="Athlete"
          value={athleteId}
          onChange={(e) => setAthleteId(e.target.value)}
          sx={{ minWidth: fieldWidths.wide }}
          placeholder={{ value: '', label: '— select an athlete —' }}
          options={roster.map((a) => ({ value: a.athleteId, label: a.name }))}
        />
        {athleteId && (
          <CopyableUrl
            label="SVO (athlete)"
            url={`${origin()}/stream/svo/${athleteId}?compId=${compId}&token=${token}${bgSuffix}`}
          />
        )}
      </Stack>
    </Box>
  );
};

/**
 * The H2R Graphics bridge link — opened in a tab on the machine running H2R (not
 * an OBS source). It follows the live selection and pushes name/country/result +
 * portrait into H2R's local `:4001` API. Discipline-agnostic (the bridge follows
 * the board's discipline), so it lives once. No `&bg=`: it has no on-camera
 * surface. See doc/dev/broadcast-overlays.md §"External graphics tools".
 */
const H2rBridgeLink = ({ compId, token }: { compId: string; token: string }) => (
  <Box sx={{ mb: 3 }}>
    <Typography variant="h6" sx={{ mb: 1 }}>
      H2R Graphics bridge
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      Open this on the machine running H2R Graphics and leave the tab open. It pushes the live
      selection to H2R&apos;s local API; override the target with <code>&amp;h2r=</code> if H2R
      isn&apos;t on the default <code>http://127.0.0.1:4001</code>.
    </Typography>
    <CopyableUrl
      label="H2R bridge"
      url={`${origin()}/stream/bridge?compId=${compId}&token=${token}`}
    />
  </Box>
);

/**
 * Per-match Head-to-head (VS) links for the chosen round. The VS overlay shows
 * exactly one matchup; an operator picks the live one without hand-editing URLs.
 * Each seeded match in the round mints a `&match=<matchId>`-scoped link, labelled
 * with the resolved athlete names (short, via the shared `useAthleteLookup` join —
 * the label chain stays local: no other hook consumer wants shortName-first).
 * Matches are gender- and discipline-scoped like the other links.
 */
const PerMatchVsLinks = ({
  compId,
  token,
  discipline,
  round,
  gender,
  bgSuffix,
}: {
  compId: string;
  token: string;
  discipline: Discipline;
  round: MatchRound;
  gender: Gender;
  bgSuffix: string;
}) => {
  const matches = useMatches(compId, gender, { discipline });
  const { byId } = useAthleteLookup(compId);

  const athleteName = (id?: string) => {
    const athlete = byId(id);
    return athlete ? athlete.shortName || athlete.name : 'TBD';
  };

  const roundMatches = (matches.data ?? [])
    .filter((m) => m.round === round)
    .sort((a, b) => a.position - b.position);

  if (roundMatches.length === 0) return null;

  const baseSuffix = `?compId=${compId}&token=${token}${
    discipline === 'speed' ? '' : `&discipline=${discipline}`
  }${bgSuffix}`;

  return (
    <>
      {roundMatches.map((match, i) => (
        <CopyableUrl
          key={`${discipline}-vs-${match.matchId}`}
          label={`VS — ${displayRoundName(match)} #${i + 1} ${athleteName(
            match.athlete1Id,
          )} vs ${athleteName(match.athlete2Id)}`}
          url={`${origin()}/stream/vs/${round}/${gender}${baseSuffix}&match=${match.matchId}`}
        />
      ))}
    </>
  );
};

/**
 * Off-air feed status for the chosen round/gender. The `/stream/*` overlays
 * fail safe (paint nothing when loading/empty/errored), so an operator cannot
 * tell from the OBS source whether a blank overlay is intentional or broken.
 * This panel answers that off-air: for each discipline it runs the same
 * rankings/matches queries the overlays use (with the admin's own credentials)
 * and reports whether each overlay would currently show content. Mirrors the
 * overlay `StreamStatus` vocabulary (loading / empty / error / ready).
 */
const OverlayStatusPanel = ({
  compId,
  round,
  gender,
}: {
  compId: string;
  round: MatchRound;
  gender: Gender;
}) => (
  <Box sx={{ mb: 3 }}>
    <Typography variant="subtitle2" sx={{ mb: 1 }} color="text.secondary">
      Live feed status — {roundLabel(round)} · {genderLabel(gender)}
    </Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: DISCIPLINE_COLUMNS, gap: 1 }}>
      {DISCIPLINE.map((discipline) => (
        <DisciplineStatus
          key={discipline}
          compId={compId}
          round={round}
          gender={gender}
          discipline={discipline}
        />
      ))}
    </Box>
  </Box>
);

const STATUS_SEVERITY: Record<StreamStatus, 'info' | 'error' | 'warning' | 'success'> = {
  loading: 'info',
  error: 'error',
  empty: 'warning',
  ready: 'success',
};

const STATUS_HINT: Record<StreamStatus, string> = {
  loading: 'checking…',
  error: 'could not load — overlay would be blank on camera',
  empty: 'no data yet — overlay will be blank on camera (intentional)',
  ready: 'has content — overlay will show on camera',
};

const DisciplineStatus = ({
  compId,
  round,
  gender,
  discipline,
}: {
  compId: string;
  round: MatchRound;
  gender: Gender;
  discipline: Discipline;
}) => {
  const rankings = useRankings(compId, round, gender, { discipline });
  const matches = useMatches(compId, gender, { discipline });

  const rankingsStatus = deriveStreamStatus(
    rankings.isLoading,
    rankings.isError,
    !Array.isArray(rankings.data) || rankings.data.length === 0,
  );
  const matchList = Array.isArray(matches.data) ? matches.data : [];
  const vsStatus = deriveStreamStatus(
    matches.isLoading,
    matches.isError,
    !matchList.some((m) => m.round === round),
  );

  // The bracket frame is always valid on-air content (TBD slots), so it is
  // `ready` whenever the matches query resolves at all.
  const bracketStatus = deriveStreamStatus(matches.isLoading, matches.isError, false);

  const worst = [rankingsStatus, vsStatus, bracketStatus].reduce<StreamStatus>(
    (acc, s) => (statusRank(s) < statusRank(acc) ? s : acc),
    'ready',
  );

  return (
    <Alert severity={STATUS_SEVERITY[worst]} sx={{ py: 0.5 }}>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
        {disciplineLabel(discipline)} feed
      </Typography>
      <Typography variant="caption" component="div">
        Rankings: {STATUS_HINT[rankingsStatus]}
      </Typography>
      <Typography variant="caption" component="div">
        Head-to-head: {STATUS_HINT[vsStatus]}
      </Typography>
      <Typography variant="caption" component="div">
        Bracket: {STATUS_HINT[bracketStatus]}
      </Typography>
    </Alert>
  );
};

/** Lower rank = more attention needed; drives the per-discipline summary severity. */
const statusRank = (s: StreamStatus): number => ({ error: 0, loading: 1, empty: 2, ready: 3 })[s];

const COPIED_MS = 2_500;

/**
 * The marker belongs to the URL that was copied, not to the field: a picker
 * change rebuilds the URL in place and the stale mark drops with it. A fresh
 * object per click restarts the fade on a re-copy.
 */
const CopyableUrl = ({ label, url }: { label: string; url: string }) => {
  const [copiedFor, setCopiedFor] = useState<{ url: string; failed: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mark = copiedFor?.url === url ? copiedFor : null;

  useEffect(() => {
    if (!copiedFor) return;
    const timeoutId = window.setTimeout(() => setCopiedFor(null), COPIED_MS);
    return () => window.clearTimeout(timeoutId);
  }, [copiedFor]);

  // `navigator.clipboard` is undefined on an insecure origin (the admin over
  // plain http on a venue LAN); that TypeError lands in the catch with a denied write.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFor({ url, failed: false });
    } catch {
      setCopiedFor({ url, failed: true });
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  const suffix = mark ? (mark.failed ? ' — copy failed, press Ctrl+C' : ' — copied!') : '';
  return (
    <TextField
      label={`${label}${suffix}`}
      value={url}
      inputRef={inputRef}
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label={`Copy ${label} link`} onClick={() => void copy()} edge="end">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
      fullWidth
    />
  );
};
