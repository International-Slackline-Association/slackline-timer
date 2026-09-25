import { useMemo, useState } from 'react';

import {
  Alert,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';

import { ApiError } from 'app/api/client';
import { DeleteConfirmDialog } from 'app/components/DeleteConfirmDialog';
import { QueryStates } from 'app/components/QueryStates';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { useAdvanceBracket, useDeleteMatch, useMatches, type SeedStage } from 'app/api/matches';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import {
  DISCIPLINE,
  GENDERS,
  MATCH_ROUNDS,
  type Discipline,
  type Gender,
  type Match,
  type MatchRound,
} from 'app/types';
import { apiErrorMessage } from 'app/util/apiError';
import { genderLabel } from 'app/util/gender';
import { displayRoundName, roundLabel } from 'app/util/rounds';
import { MatchForm } from 'app/pages/Admin/MatchForm';
import { PlayoffBracket, type BracketVariant } from 'app/pages/Admin/PlayoffBracket';

/**
 * `/admin/matches` — CRUD over a competition's matches. Matches are keyed
 * gender-first, so the page works one gender at a time (selector); rounds are
 * filtered client-side and rows are ordered by round then position.
 */
export const MatchesPage = () => (
  <SelectCompetitionGate title="Matches">
    {(compId) => <MatchesManager compId={compId} />}
  </SelectCompetitionGate>
);

const ALL = '';
const disciplineLabel = (discipline: Discipline) =>
  discipline === 'speed' ? 'Speed' : 'Freestyle';
const roundOrder = (round: string) => MATCH_ROUNDS.indexOf(round as (typeof MATCH_ROUNDS)[number]);

/**
 * The bracket progression steps, source-first. `qualification` seeds the
 * bracket entry round (quarters or semis) from the qualification ranking; the
 * rest advance winners into the next round. All go through the one `advance`
 * route (the server dispatches on the from-stage); the dropdown value is that
 * from-stage.
 */
const ADVANCE_STAGES: { from: MatchRound; label: string }[] = [
  { from: 'qualification', label: 'Qualification → Bracket' },
  { from: 'quarter', label: 'Quarters → Semis' },
  { from: 'half', label: 'Semis → Final' },
];

/**
 * Seed-stage choices for the qualification step. `auto` (the default) lets the
 * server's field-size heuristic pick (≥9 ranked → quarters, else semis); the
 * two overrides force an entry stage when the rules are amended on site.
 */
const SEED_STAGES: { value: 'auto' | SeedStage; label: string }[] = [
  { value: 'auto', label: 'Auto (field size)' },
  { value: 'quarter', label: 'Quarter-finals (top 8)' },
  { value: 'half', label: 'Semi-finals (top 4)' },
];

/**
 * One server-authoritative bracket-advance control: run the chosen progression
 * step (see ADVANCE_STAGES / SEED_STAGES above) through the single `advance`
 * route. The server refuses a destructive overwrite with 409 unless forced —
 * caught here and turned into a confirm dialog that re-submits with `force: true`.
 */
const BracketActions = ({
  compId,
  discipline,
  gender,
}: {
  compId: string;
  discipline: Discipline;
  gender: Gender;
}) => {
  const advanceBracket = useAdvanceBracket(compId);
  const [fromStage, setFromStage] = useState<MatchRound>('qualification');
  const [seedStage, setSeedStage] = useState<'auto' | SeedStage>('auto');
  // A pending force action awaiting confirmation after a 409.
  const [confirm, setConfirm] = useState<{ message: string } | null>(null);

  const is409 = (e: unknown) => e instanceof ApiError && e.status === 409;

  const run = (force: boolean) => {
    advanceBracket.mutate(
      {
        discipline,
        gender,
        fromRound: fromStage,
        force,
        ...(fromStage === 'qualification' && seedStage !== 'auto' ? { stage: seedStage } : {}),
      },
      {
        onSuccess: () => setConfirm(null),
        onError: (e: unknown) => {
          if (is409(e) && !force) setConfirm({ message: apiErrorMessage(e) });
        },
      },
    );
  };

  const pending = advanceBracket.isPending;
  // A non-409 error (e.g. 400 too-few-ranked, missing winners) shown inline.
  const error =
    (advanceBracket.error && !is409(advanceBracket.error) && advanceBracket.error) || null;

  return (
    <>
      <SelectField
        size="small"
        label="Advance bracket"
        value={fromStage}
        onChange={(e) => setFromStage(e.target.value as MatchRound)}
        sx={{ minWidth: 220 }}
        options={ADVANCE_STAGES.map((s) => ({ value: s.from, label: s.label }))}
      />
      {fromStage === 'qualification' && (
        <SelectField
          size="small"
          label="Seed stage"
          value={seedStage}
          onChange={(e) => setSeedStage(e.target.value as 'auto' | SeedStage)}
          sx={{ minWidth: 190 }}
          options={SEED_STAGES.map((s) => ({ value: s.value, label: s.label }))}
        />
      )}
      <Button variant="outlined" onClick={() => run(false)} disabled={pending}>
        Advance bracket
      </Button>
      {error && (
        <Alert severity="error" sx={{ py: 0 }}>
          {apiErrorMessage(error)}
        </Alert>
      )}

      <Dialog open={confirm != null} onClose={() => setConfirm(null)}>
        <DialogTitle>Overwrite existing bracket?</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="warning" variant="contained" disabled={pending} onClick={() => run(true)}>
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

const MatchesManager = ({ compId }: { compId: string }) => {
  const [discipline, setDiscipline] = useState<Discipline>('speed');
  const [gender, setGender] = useState<Gender>('male');
  const [roundFilter, setRoundFilter] = useState<string>(ALL);
  const [view, setView] = useState<'table' | 'bracket'>('table');
  // Local preview-only toggle: see the name-tree layout before minting a live
  // overlay link. The overlay variant itself is chosen on /admin/overlays.
  const [bracketVariant, setBracketVariant] = useState<BracketVariant>('profile');
  const matches = useMatches(compId, gender, { discipline });
  const { athletes, byId: athleteById } = useAthleteLookup(compId);
  const deleteMatch = useDeleteMatch(compId);

  const [formTarget, setFormTarget] = useState<Match | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Match | null>(null);

  const athleteName = (id?: string): string =>
    id ? (athleteById(id)?.name ?? '(unknown)') : 'TBD';

  const rows = useMemo(() => {
    const all = matches.data ?? [];
    return all
      .filter((m) => roundFilter === ALL || m.round === roundFilter)
      .slice()
      .sort((a, b) => roundOrder(a.round) - roundOrder(b.round) || a.position - b.position);
  }, [matches.data, roundFilter]);

  const closeDelete = () => {
    setDeleteTarget(null);
    deleteMatch.reset();
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMatch.mutate(deleteTarget.matchId, { onSuccess: closeDelete });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Two toolbar rows is the ceiling before the page reads as a form: the
          title row carries what selects the VIEW, the filter row what acts on
          the SELECTION. Both wrap rather than squeeze — unwrapped, the tablet
          widths collapsed the title into the toggles and broke the buttons over
          two lines each. */}
      <Stack
        direction="row"
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 1,
          mb: 3,
        }}
      >
        <Typography variant="h4">Matches</Typography>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={discipline}
            onChange={(_, v) => v && setDiscipline(v)}
            aria-label="discipline"
          >
            {DISCIPLINE.map((d) => (
              <ToggleButton key={d} value={d}>
                {disciplineLabel(d)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
            aria-label="view"
          >
            <ToggleButton value="table">Table</ToggleButton>
            <ToggleButton value="bracket">Bracket</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" onClick={() => setFormTarget('new')}>
            Add match
          </Button>
        </Stack>
      </Stack>

      {/* Filter row: what the board is scoped to on the left, the actions that
          act on exactly that scope (seed/advance this discipline+gender) on the
          right — each side its own Stack so a wrap moves a whole group, never
          splits one. */}
      <Stack
        direction="row"
        spacing={2}
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 2,
          mb: 3,
        }}
      >
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}
        >
          <SelectField
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
            sx={{ minWidth: 160 }}
            options={enumOptions(GENDERS, genderLabel)}
          />
          {view === 'bracket' && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={bracketVariant}
              onChange={(_, v: BracketVariant | null) => v && setBracketVariant(v)}
              aria-label="bracket layout"
            >
              <ToggleButton value="profile">Photos</ToggleButton>
              <ToggleButton value="name">Names</ToggleButton>
            </ToggleButtonGroup>
          )}
          {view === 'table' && (
            <SelectField
              label="Filter by round"
              value={roundFilter}
              onChange={(e) => setRoundFilter(e.target.value)}
              sx={{ minWidth: 200 }}
              placeholder={{ value: ALL, label: 'All rounds' }}
              options={enumOptions(MATCH_ROUNDS, roundLabel)}
            />
          )}
        </Stack>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}
        >
          <BracketActions compId={compId} discipline={discipline} gender={gender} />
        </Stack>
      </Stack>

      <QueryStates
        query={matches}
        alsoLoading={athletes.isLoading}
        empty={`No ${genderLabel(gender).toLowerCase()} matches yet.`}
      />
      {view === 'bracket' && matches.data && matches.data.length > 0 && (
        <PlayoffBracket matches={matches.data} athleteById={athleteById} variant={bracketVariant} />
      )}

      {view === 'table' && matches.data && matches.data.length > 0 && rows.length === 0 && (
        <Typography color="text.secondary">No matches match the current filters.</Typography>
      )}

      {view === 'table' && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Round</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">Pos.</TableCell>
              <TableCell>Athlete 1</TableCell>
              <TableCell>Athlete 2</TableCell>
              <TableCell>Winner</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((match) => (
              <TableRow key={match.matchId}>
                <TableCell>{roundLabel(match.round)}</TableCell>
                <TableCell>{displayRoundName(match)}</TableCell>
                <TableCell align="right">{match.position}</TableCell>
                <TableCell>{athleteName(match.athlete1Id)}</TableCell>
                <TableCell>{athleteName(match.athlete2Id)}</TableCell>
                <TableCell>
                  {match.winnerId ? (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <EmojiEventsIcon fontSize="small" color="warning" />
                      <span>{athleteName(match.winnerId)}</span>
                    </Stack>
                  ) : (
                    <Typography component="span" color="text.secondary">
                      —
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    aria-label={`Edit ${displayRoundName(match)}`}
                    onClick={() => setFormTarget(match)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${displayRoundName(match)}`}
                    onClick={() => setDeleteTarget(match)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {formTarget && (
        <MatchForm
          compId={compId}
          athletes={athletes.data ?? []}
          match={formTarget === 'new' ? undefined : formTarget}
          discipline={discipline}
          open
          onClose={() => setFormTarget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        title="Delete match"
        error={deleteMatch.error}
        pending={deleteMatch.isPending}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
      >
        Delete {deleteTarget ? displayRoundName(deleteTarget) : ''}? This cannot be undone.
      </DeleteConfirmDialog>
    </Container>
  );
};
