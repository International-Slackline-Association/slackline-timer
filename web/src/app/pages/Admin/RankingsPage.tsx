import { ReactNode, useState } from 'react';

import {
  Container,
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

import { useCombinedRanking, useOverallStandings, useRankings } from 'app/api/rankings';
import { CountryFlag } from 'app/components/CountryFlag';
import { QueryStates } from 'app/components/QueryStates';
import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectField, enumOptions } from 'app/components/SelectField';
import {
  DISCIPLINE,
  GENDERS,
  MATCH_ROUNDS,
  TIME_ROUNDS,
  type Athlete,
  type Discipline,
  type Gender,
  type StandingsView,
  type TimeRound,
} from 'app/types';
import { genderLabel } from 'app/util/gender';
import { serverRankLabels } from 'app/util/rankLabels';
import { formatScore, standingsResultLabel } from 'app/util/resultLabel';
import { roundLabel } from 'app/util/rounds';
import { formatMs } from 'app/util/time';

/**
 * `/admin/rankings` — per-round, per-gender ranking, fed by the rankings Lambda.
 * Speed ranks by best time (DNF is a large sentinel so it sorts last and renders
 * "DNF"); freestyle ranks by the judged `overall` (higher is better) and shows
 * the score component breakdown. Athletes with no result are excluded server-side.
 * The extra "Final standings" round is the `overall` pseudo-round (rule G3):
 * bracket outcomes merged with quali, server-ranked, provisional ranks dimmed.
 * "Combined" is the `combined` pseudo-round (rule G2): the cross-discipline
 * average of the two overall placements — the discipline toggle disables there.
 */
export const RankingsPage = () => (
  <SelectCompetitionGate title="Rankings">
    {(compId) => <RankingsView compId={compId} />}
  </SelectCompetitionGate>
);

const disciplineLabel = (discipline: Discipline) =>
  discipline === 'speed' ? 'Speed' : 'Freestyle';

/**
 * The leading cells every rankings table shares — rank numeral (dimmed while
 * provisional), country flag, athlete name. Each table keeps its own trailing
 * result cells as children, so column/sort definitions stay explicit per table.
 */
const RankingRow = ({
  rank,
  provisional,
  athlete,
  children,
}: {
  rank: ReactNode;
  provisional?: boolean;
  athlete: Pick<Athlete, 'name' | 'country'>;
  children: ReactNode;
}) => (
  <TableRow>
    <TableCell align="right" sx={provisional ? { color: 'text.disabled' } : undefined}>
      {rank}
    </TableCell>
    <TableCell>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CountryFlag code={athlete.country} showCode />
      </Stack>
    </TableCell>
    <TableCell>{athlete.name}</TableCell>
    {children}
  </TableRow>
);

type RoundOption = TimeRound | StandingsView;

const roundOptionsFor = (discipline: Discipline): readonly RoundOption[] => [
  ...(discipline === 'freestyle' ? MATCH_ROUNDS : TIME_ROUNDS),
  'overall',
  'combined',
];

const RankingsView = ({ compId }: { compId: string }) => {
  const [discipline, setDiscipline] = useState<Discipline>('speed');
  const [round, setRound] = useState<RoundOption>('qualification');
  const [gender, setGender] = useState<Gender>('male');
  const isFreestyle = discipline === 'freestyle';
  // Best trick + control penalty are battles-only (rule F8): drop their columns
  // from the freestyle quali ranking (every quali Score is 0 for both).
  const hideBattleOnly = round === 'qualification';
  const isStandings = round === 'overall';
  const isCombined = round === 'combined';
  const roundOptions = roundOptionsFor(discipline);
  // The three queries are mutually exclusive per selection; a null compId
  // disables the inactive ones (the hooks' built-in enabled gate).
  const rankings = useRankings(
    isStandings || isCombined ? null : compId,
    round as TimeRound,
    gender,
    { discipline: isFreestyle ? 'freestyle' : undefined },
  );
  const standings = useOverallStandings(isStandings ? compId : null, gender, {
    discipline: isFreestyle ? 'freestyle' : undefined,
  });
  const combined = useCombinedRanking(isCombined ? compId : null, gender);
  const active = isCombined ? combined : isStandings ? standings : rankings;
  const combinedRankLabels = serverRankLabels((combined.data ?? []).map((e) => e.rank));

  // Switching discipline can leave a round the new discipline doesn't offer
  // (e.g. freestyle has no `training`); snap back to a valid one.
  const changeDiscipline = (next: Discipline) => {
    setDiscipline(next);
    if (!roundOptionsFor(next).includes(round)) setRound('qualification');
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Rankings</Typography>
        {/* The combined view is cross-discipline by definition — no plane to pick. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          disabled={isCombined}
          value={discipline}
          onChange={(_, v) => v && changeDiscipline(v)}
          aria-label="discipline"
        >
          {DISCIPLINE.map((d) => (
            <ToggleButton key={d} value={d}>
              {disciplineLabel(d)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <SelectField
          label="Round"
          value={round}
          onChange={(e) => setRound(e.target.value as RoundOption)}
          sx={{ minWidth: 200 }}
          options={enumOptions(roundOptions, roundLabel)}
        />
        <SelectField
          label="Gender"
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender)}
          sx={{ minWidth: 160 }}
          options={enumOptions(GENDERS, genderLabel)}
        />
      </Stack>

      <QueryStates
        query={active}
        empty={
          isCombined
            ? `No combined ranking yet for ${genderLabel(gender).toLowerCase()} — it needs standings in both disciplines.`
            : isStandings
              ? `No standings yet for ${genderLabel(gender).toLowerCase()}.`
              : `No ${isFreestyle ? 'scores' : 'times'} in ${roundLabel(round)} for ${genderLabel(
                  gender,
                ).toLowerCase()} yet.`
        }
      />

      {isCombined && combined.data && combined.data.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell align="right">Rank</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Athlete</TableCell>
              <TableCell align="right">Speed rank</TableCell>
              <TableCell align="right">Freestyle rank</TableCell>
              <TableCell align="right">Combined</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {combined.data.map((entry, index) => (
              <RankingRow
                key={entry.athlete.athleteId}
                rank={combinedRankLabels[index]}
                provisional={entry.provisional}
                athlete={entry.athlete}
              >
                <TableCell align="right">{entry.speedRank}</TableCell>
                <TableCell align="right">{entry.freestyleRank}</TableCell>
                <TableCell align="right">{entry.combined.toFixed(1)}</TableCell>
              </RankingRow>
            ))}
          </TableBody>
        </Table>
      )}

      {isStandings && standings.data && standings.data.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell align="right">Rank</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Athlete</TableCell>
              <TableCell align="right">Result</TableCell>
              <TableCell>Source</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {standings.data.map((entry) => (
              <RankingRow
                key={entry.athlete.athleteId}
                rank={entry.rank}
                provisional={entry.provisional}
                athlete={entry.athlete}
              >
                <TableCell align="right">{standingsResultLabel(discipline, entry)}</TableCell>
                <TableCell>{roundLabel(entry.source)}</TableCell>
              </RankingRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rankings.data && rankings.data.length > 0 && isFreestyle && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell align="right">Rank</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Athlete</TableCell>
              <TableCell align="right">Difficulty</TableCell>
              <TableCell align="right">Combo</TableCell>
              <TableCell align="right">Style</TableCell>
              {!hideBattleOnly && <TableCell align="right">Best trick</TableCell>}
              {!hideBattleOnly && <TableCell align="right">Control penalty</TableCell>}
              <TableCell align="right">Overall</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rankings.data.map((entry, index) => (
              <RankingRow key={entry.athlete.athleteId} rank={index + 1} athlete={entry.athlete}>
                <TableCell align="right">{entry.score?.difficulty}</TableCell>
                <TableCell align="right">{entry.score?.combo}</TableCell>
                <TableCell align="right">{entry.score?.style}</TableCell>
                {!hideBattleOnly && <TableCell align="right">{entry.score?.bestTrick}</TableCell>}
                {!hideBattleOnly && (
                  <TableCell align="right">{entry.score?.controlPenalty}</TableCell>
                )}
                <TableCell align="right">
                  {entry.dnf ? 'DNF' : formatScore(entry.overall ?? 0)}
                </TableCell>
              </RankingRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rankings.data && rankings.data.length > 0 && !isFreestyle && (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell align="right">Rank</TableCell>
              <TableCell>Country</TableCell>
              <TableCell>Athlete</TableCell>
              <TableCell align="right">Best time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rankings.data.map((entry, index) => (
              <RankingRow key={entry.athlete.athleteId} rank={index + 1} athlete={entry.athlete}>
                <TableCell align="right">{formatMs(entry.bestTimeMs)}</TableCell>
              </RankingRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Container>
  );
};
