import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  Button,
  Container,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

import { useDeleteScore, useScores } from 'app/api/scores';
import { DeleteConfirmDialog } from 'app/components/DeleteConfirmDialog';
import { QueryStates } from 'app/components/QueryStates';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectField, enumOptions } from 'app/components/SelectField';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { GENDERS, MATCH_ROUNDS, type Athlete, type Score } from 'app/types';
import { formatScore } from 'app/util/resultLabel';
import { genderLabel } from 'app/util/gender';
import { roundLabel } from 'app/util/rounds';
import { scoresFilterSeed } from 'app/util/scoresLink';
import { ScoreForm } from 'app/pages/Admin/ScoreForm';

/**
 * `/admin/scores` — list / correct / delete freestyle judged scores for the
 * selected competition. One score per athlete per round; filterable by athlete,
 * round, and gender (joined from the athlete), ordered by overall
 * (highest first, DNF last).
 */
export const ScoresPage = () => (
  <SelectCompetitionGate title="Scores">
    {(compId) => <ScoresManager compId={compId} />}
  </SelectCompetitionGate>
);

const ALL = '';

const ScoresManager = ({ compId }: { compId: string }) => {
  const scores = useScores(compId);
  const { athletes, byId, athleteName, athleteGender } = useAthleteLookup(compId);
  const deleteScore = useDeleteScore(compId);

  const [formTarget, setFormTarget] = useState<Score | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Score | null>(null);
  // Seeded from the URL, once: a correction link off the Freestyle board names
  // the row it wants (`scoresLink`), and from there the pickers are the
  // operator's — a later seed would fight them for filters they just widened.
  const seed = scoresFilterSeed(useLocation().search);
  const [athleteFilter, setAthleteFilter] = useState<string>(seed.athleteId);
  const [roundFilter, setRoundFilter] = useState<string>(seed.round);
  const [genderFilter, setGenderFilter] = useState<string>(ALL);

  // A link can name an athlete this competition doesn't have (a stale bookmark,
  // or the other competition selected in this tab): once the roster has loaded
  // and disagrees, the filter is dropped rather than leaving the operator on an
  // empty table under a picker showing nothing.
  const athleteShown = !athletes.data || byId(athleteFilter) ? athleteFilter : ALL;

  const rows = useMemo(() => {
    const all = scores.data ?? [];
    return all
      .filter(
        (s) =>
          (athleteShown === ALL || s.athleteId === athleteShown) &&
          (roundFilter === ALL || s.round === roundFilter) &&
          (genderFilter === ALL || byId(s.athleteId)?.gender === genderFilter),
      )
      .slice()
      .sort((a, b) => {
        if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1;
        return (b.overall ?? 0) - (a.overall ?? 0);
      });
  }, [scores.data, athleteShown, roundFilter, genderFilter, byId]);

  // Best trick + control penalty are battles-only (rule F8): drop their columns
  // when the list is filtered to qualification (every quali Score is 0 for both).
  const hideBattleOnly = roundFilter === 'qualification';

  const closeDelete = () => {
    setDeleteTarget(null);
    deleteScore.reset();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteScore.mutate(deleteTarget.scoreId, { onSuccess: closeDelete });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Scores</Typography>
        <Button variant="contained" onClick={() => setFormTarget('new')}>
          Add score
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <SelectField
          label="Filter by athlete"
          value={athleteShown}
          onChange={(e) => setAthleteFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All athletes' }}
          options={(athletes.data ?? []).map((a: Athlete) => ({
            value: a.athleteId,
            label: a.name,
          }))}
        />
        <SelectField
          label="Filter by round"
          value={roundFilter}
          onChange={(e) => setRoundFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All rounds' }}
          options={enumOptions(MATCH_ROUNDS, roundLabel)}
        />
        <SelectField
          label="Filter by gender"
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
          sx={{ minWidth: 200 }}
          placeholder={{ value: ALL, label: 'All genders' }}
          options={enumOptions(GENDERS, (g) => genderLabel(g, 'subject'))}
        />
      </Stack>

      <QueryStates
        query={scores}
        alsoLoading={athletes.isLoading}
        empty="No scores recorded yet."
      />
      {scores.data && scores.data.length > 0 && rows.length === 0 && (
        <Typography color="text.secondary">No scores match the current filters.</Typography>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Athlete</TableCell>
              <TableCell>Gender</TableCell>
              <TableCell>Round</TableCell>
              <TableCell align="right">Difficulty</TableCell>
              <TableCell align="right">Combo</TableCell>
              <TableCell align="right">Style</TableCell>
              {!hideBattleOnly && <TableCell align="right">Best trick</TableCell>}
              {!hideBattleOnly && <TableCell align="right">Control penalty</TableCell>}
              <TableCell align="right">Overall</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((score) => (
              <TableRow key={score.scoreId}>
                <TableCell>{athleteName(score.athleteId)}</TableCell>
                <TableCell>{athleteGender(score.athleteId)}</TableCell>
                <TableCell>{roundLabel(score.round)}</TableCell>
                <TableCell align="right">{formatScore(score.difficulty ?? 0)}</TableCell>
                <TableCell align="right">{formatScore(score.combo ?? 0)}</TableCell>
                <TableCell align="right">{formatScore(score.style ?? 0)}</TableCell>
                {!hideBattleOnly && (
                  <TableCell align="right">{formatScore(score.bestTrick ?? 0)}</TableCell>
                )}
                {!hideBattleOnly && (
                  <TableCell align="right">{formatScore(score.controlPenalty ?? 0)}</TableCell>
                )}
                <TableCell align="right">
                  {score.dnf ? 'DNF' : formatScore(score.overall ?? 0)}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    aria-label={`Edit score for ${athleteName(score.athleteId)}`}
                    onClick={() => setFormTarget(score)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete score for ${athleteName(score.athleteId)}`}
                    onClick={() => setDeleteTarget(score)}
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
        <ScoreForm
          compId={compId}
          athletes={athletes.data ?? []}
          score={formTarget === 'new' ? undefined : formTarget}
          open
          onClose={() => setFormTarget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        title="Delete score"
        error={deleteScore.error}
        pending={deleteScore.isPending}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
      >
        Delete the {deleteTarget ? roundLabel(deleteTarget.round) : ''} score for{' '}
        {deleteTarget ? athleteName(deleteTarget.athleteId) : ''}? This cannot be undone.
      </DeleteConfirmDialog>
    </Container>
  );
};
