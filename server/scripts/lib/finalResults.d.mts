// Hand-written declarations for finalResults.mjs — the module stays plain ESM so
// the seed scripts can import it directly, while the TS test suite still
// typechecks against it (same arrangement as seedPreflight.mjs).

export declare const FINAL_RUNS: number;

export type FinalRound = 'final' | 'small_final';

export interface FinalMatch {
  matchId?: string;
  round: FinalRound;
  athlete1Id?: string;
  athlete2Id?: string;
  winnerId?: string;
}

export interface FinalTimeRow {
  athleteId: string;
  round: FinalRound;
  matchId: string;
  timeMs: number;
  startTime: number;
}

export interface FinalScoreComponents {
  difficulty: number;
  combo: number;
  style: number;
  bestTrick: number;
  controlPenalty: number;
}

export type FinalScoreRow = FinalScoreComponents & {
  athleteId: string;
  round: FinalRound;
  matchId: string;
};

export declare const buildFinalResults: (opts: {
  discipline: 'speed' | 'freestyle';
  match: FinalMatch;
  runsFor: (athleteId: string) => number[];
  scoreFor: (athleteId: string) => FinalScoreComponents;
  startEpoch: number;
}) => { times: FinalTimeRow[]; scores: FinalScoreRow[] };
