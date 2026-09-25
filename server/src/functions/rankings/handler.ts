import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from 'aws-lambda';
import { competitionDb } from 'core/competitionDb';
import { computeEventExpiry } from 'core/eventWindow';
import {
  AuthContext,
  HttpError,
  errorResponse,
  forAudience,
  getAuth,
  json,
  loadCompetitionOrThrow,
  requireCompAccess,
} from 'core/http';
import { attachPhotoUrl, photoUrlSignerFromEnv } from 'core/photoUrl';
import {
  bestTimeByAthlete,
  rankAthletesByBestTime,
  rankAthletesByOverall,
  rankAthletesWithAllTimes,
} from 'core/rankings';
import {
  computeCombinedRanking,
  computeOverallStandings,
  type StandingsSource,
} from 'core/standings';
import type { Athlete, Discipline, MatchRound, TimeRound } from 'core/types';
import { isDiscipline, isGender, isMatchRound, isTimeRound } from 'core/types';

/**
 * The standings result for a placement together with the round it actually came
 * from. A bracket placement can predate its own result (an athlete placed in the
 * final who never ran it), so the value falls back to qualification — and the
 * reported `source` follows the VALUE, not the placement: an overlay captions the
 * row with this round, and `SMALL FINAL 0:06.60` over a qualification time is
 * wrong provenance on air. With no result anywhere there is nothing to
 * attribute, so the placement round stands and the client renders an em dash.
 */
const resultWithProvenance = <T>(
  placement: StandingsSource,
  lookup: (round: StandingsSource) => T | undefined,
): { value: T | undefined; source: StandingsSource } => {
  const placed = placement !== 'qualification' ? lookup(placement) : undefined;
  if (placed !== undefined) return { value: placed, source: placement };
  const quali = lookup('qualification');
  return quali === undefined
    ? { value: undefined, source: placement }
    : { value: quali, source: 'qualification' };
};

/**
 * GET /competitions/{compId}/rankings/{round}?gender=male|female[&allTimes=true][&discipline=]
 *
 * DynamoDB cannot aggregate: the Lambda queries the round's times (speed) or
 * scores (freestyle) plus the athlete list and ranks in memory
 * (core/rankings.ts). Per-gender ranking is a join against the athlete list;
 * speed sorts DNF last by sentinel value, freestyle sorts by overall DESC.
 *
 * The pseudo-round `overall` (rule G3) is not a stored round: it merges the
 * bracket outcomes with the qualification ranking into final overall standings
 * (core/standings.ts). Each row carries the athlete's best result from its
 * placement's `source` round, falling back to qualification — a resultless
 * placement is still emitted (the client renders "—").
 *
 * The pseudo-round `combined` (rule G2) is the cross-discipline layer over the
 * same standings: (speed rank + freestyle rank) / 2 per gender, intersection
 * only, equal averages sharing the rank. The `discipline` param is ignored —
 * the view is cross-discipline by definition.
 */
export const main: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext> = async (event) => {
  try {
    const auth = getAuth(event);
    const compId = event.pathParameters!.compId!;
    await requireCompAccess(auth, compId);

    const competition = await loadCompetitionOrThrow(compId);

    const gender = event.queryStringParameters?.gender;
    if (!isGender(gender)) throw new HttpError(400, 'gender query param must be male or female');

    const discipline = event.queryStringParameters?.discipline ?? 'speed';
    if (!isDiscipline(discipline)) throw new HttpError(400, `unknown discipline: ${discipline}`);

    const signer = await photoUrlSignerFromEnv();
    const expiresAt = computeEventExpiry(competition.endDate, Date.now());

    const round = event.pathParameters?.round;
    const audience = (a: Athlete) => attachPhotoUrl(forAudience(a, auth), signer, expiresAt);

    if (round === 'combined') {
      // One bare-MATCH# query covers both disciplines; split in memory. The
      // API's most expensive read (4 partition queries + the comp GetItem),
      // still trivially within ADR 0030's envelope.
      const [athletes, matches, times, scores] = await Promise.all([
        competitionDb.listAthletes(compId),
        competitionDb.listMatches(compId),
        competitionDb.listTimes(compId),
        competitionDb.listScores(compId),
      ]);
      const names = new Map(athletes.map((a) => [a.athleteId, a.name]));
      const byId = new Map(athletes.map((a) => [a.athleteId, a]));

      const standingsFor = (plane: Discipline, qualiOrder: string[]) =>
        computeOverallStandings(
          matches.filter((m) => m.discipline === plane && m.gender === gender),
          qualiOrder,
          names,
        );
      const speedStandings = standingsFor(
        'speed',
        rankAthletesByBestTime(
          athletes,
          times.filter((t) => t.round === 'qualification'),
          gender,
        ).map((r) => r.athlete.athleteId),
      );
      const freestyleStandings = standingsFor(
        'freestyle',
        rankAthletesByOverall(
          athletes,
          scores.filter((s) => s.round === 'qualification'),
          gender,
        ).map((r) => r.athlete.athleteId),
      );

      return json(
        200,
        computeCombinedRanking(speedStandings, freestyleStandings, names).flatMap((p) => {
          const a = byId.get(p.athleteId);
          if (!a) return [];
          return [
            {
              athlete: audience(a),
              rank: p.rank,
              combined: p.combined,
              speedRank: p.speedRank,
              freestyleRank: p.freestyleRank,
              ...(p.provisional ? { provisional: true } : {}),
            },
          ];
        }),
      );
    }

    if (round === 'overall') {
      const [athletes, matches] = await Promise.all([
        competitionDb.listAthletes(compId),
        competitionDb.listMatches(compId, discipline, gender),
      ]);
      const names = new Map(athletes.map((a) => [a.athleteId, a.name]));
      const byId = new Map(athletes.map((a) => [a.athleteId, a]));

      if (discipline === 'freestyle') {
        const scores = await competitionDb.listScores(compId);
        const quali = rankAthletesByOverall(
          athletes,
          scores.filter((s) => s.round === 'qualification'),
          gender,
        );
        const placements = computeOverallStandings(
          matches,
          quali.map((r) => r.athlete.athleteId),
          names,
        );
        const scoreOf = (athleteId: string, r: MatchRound) =>
          scores.find((s) => s.athleteId === athleteId && s.round === r);
        return json(
          200,
          placements.flatMap((p) => {
            const a = byId.get(p.athleteId);
            if (!a) return [];
            const { value: score, source } = resultWithProvenance(p.source, (r) =>
              scoreOf(p.athleteId, r),
            );
            return [
              {
                athlete: audience(a),
                rank: p.rank,
                source,
                ...(p.provisional ? { provisional: true } : {}),
                ...(score
                  ? { overall: score.overall, score, ...(score.dnf === true ? { dnf: true } : {}) }
                  : {}),
              },
            ];
          }),
        );
      }

      const times = await competitionDb.listTimes(compId);
      const quali = rankAthletesByBestTime(
        athletes,
        times.filter((t) => t.round === 'qualification'),
        gender,
      );
      const placements = computeOverallStandings(
        matches,
        quali.map((r) => r.athlete.athleteId),
        names,
      );
      const bestByRound = new Map<TimeRound, Map<string, number>>();
      const bestIn = (athleteId: string, r: TimeRound): number | undefined => {
        let best = bestByRound.get(r);
        if (!best) {
          best = bestTimeByAthlete(times.filter((t) => t.round === r));
          bestByRound.set(r, best);
        }
        return best.get(athleteId);
      };
      return json(
        200,
        placements.flatMap((p) => {
          const a = byId.get(p.athleteId);
          if (!a) return [];
          const { value: bestTimeMs, source } = resultWithProvenance(p.source, (r) =>
            bestIn(p.athleteId, r),
          );
          return [
            {
              athlete: audience(a),
              rank: p.rank,
              source,
              ...(p.provisional ? { provisional: true } : {}),
              ...(bestTimeMs !== undefined ? { bestTimeMs } : {}),
            },
          ];
        }),
      );
    }

    // Freestyle rounds come from MATCH_ROUNDS (no `training`), speed from TIME_ROUNDS.
    if (discipline === 'freestyle') {
      if (!isMatchRound(round)) throw new HttpError(400, `unknown round: ${round}`);

      const [athletes, scores] = await Promise.all([
        competitionDb.listAthletes(compId),
        competitionDb.listScores(compId, round),
      ]);
      return json(
        200,
        rankAthletesByOverall(athletes, scores, gender).map((entry) => ({
          ...entry,
          athlete: audience(entry.athlete),
        })),
      );
    }

    if (!isTimeRound(round)) throw new HttpError(400, `unknown round: ${round}`);

    const withAllTimes = event.queryStringParameters?.allTimes === 'true';

    const [athletes, times] = await Promise.all([
      competitionDb.listAthletes(compId),
      competitionDb.listTimes(compId, round),
    ]);

    const ranking = withAllTimes
      ? rankAthletesWithAllTimes(athletes, times, gender)
      : rankAthletesByBestTime(athletes, times, gender);

    return json(
      200,
      ranking.map((entry) => ({
        ...entry,
        athlete: audience(entry.athlete),
      })),
    );
  } catch (e) {
    return errorResponse(e);
  }
};
