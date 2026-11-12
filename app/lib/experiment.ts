export type Stage = "setup" | "practice" | "competition" | "finished";
export type TimerPhase = "idle" | "countdown" | "running" | "paused" | "finished";

export type Settings = {
  participantCount: number;
  dartCount: number;
  practiceRounds: number;
  competitionRounds: number;
  durationSeconds: number;
  countdownSeconds: number;
  maxScore: number;
  prizeAmount: number;
};

export type TimerState = {
  phase: TimerPhase;
  secondsLeft: number;
  countdownLeft: number;
  endAt: number | null;
  pausedPhase?: "countdown" | "running";
};

export type PrizeDraw = {
  drawnAt: string;
  prizeAmount: number;
  winnerParticipant: number;
  winningTicket: number;
  totalTickets: number;
  rankingMethod?: "shared_rank";
  ranking: { participant: number; score: number; rank: number; tickets: number; tied: boolean }[];
};

export type ExperimentState = {
  version: 1;
  id: string;
  sessionCode: string;
  createdAt: string;
  updatedAt: string;
  stage: Stage;
  currentRound: number;
  currentParticipant: number;
  settings: Settings;
  timer: TimerState;
  competitionScores: Record<string, number[]>;
  practiceScores: Record<string, number[]>;
  practicePositions: number[];
  notes: string;
  prizeDraw?: PrizeDraw;
  prizeDrawPending?: boolean;
};

export const STORAGE_KEY = "photos-experiment-state-v1";
export const CHANNEL_NAME = "photos-experiment-live";

export const defaultSettings: Settings = {
  participantCount: 6,
  dartCount: 5,
  practiceRounds: 1,
  competitionRounds: 4,
  durationSeconds: 10,
  countdownSeconds: 3,
  maxScore: 10,
  prizeAmount: 10,
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `photos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSessionCode() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `pothos${part("year")}${part("month")}${part("day")}_${part("hour")}${part("minute")}`;
}

export function createExperiment(): ExperimentState {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: makeId(),
    sessionCode: makeSessionCode(),
    createdAt: now,
    updatedAt: now,
    stage: "setup",
    currentRound: 1,
    currentParticipant: 1,
    settings: defaultSettings,
    timer: {
      phase: "idle",
      secondsLeft: defaultSettings.durationSeconds,
      countdownLeft: defaultSettings.countdownSeconds,
      endAt: null,
    },
    competitionScores: {},
    practiceScores: {},
    practicePositions: drawPracticePositions(defaultSettings.participantCount),
    notes: "",
  };
}

export function scoreKey(round: number, participant: number) {
  return `${round}-${participant}`;
}

export function emptyThrows(count: number) {
  return Array.from({ length: count }, () => 0);
}

export function throwsFor(
  scores: Record<string, number[]>,
  round: number,
  participant: number,
  dartCount: number,
) {
  const existing = scores[scoreKey(round, participant)] ?? [];
  return Array.from({ length: dartCount }, (_, i) => Number(existing[i] ?? 0));
}

export function total(values: number[]) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function roundTotal(
  state: ExperimentState,
  participant: number,
  round: number,
  practice = false,
) {
  const source = practice ? state.practiceScores : state.competitionScores;
  return total(throwsFor(source, round, participant, state.settings.dartCount));
}

export function cumulativeTotal(state: ExperimentState, participant: number) {
  let sum = 0;
  for (let round = 1; round <= state.settings.competitionRounds; round += 1) {
    sum += roundTotal(state, participant, round);
  }
  return sum;
}

export function competitionRanking(state: ExperimentState) {
  return Array.from({ length: state.settings.participantCount }, (_, index) => ({
    participant: index + 1,
    score: cumulativeTotal(state, index + 1),
  })).sort((a, b) => b.score - a.score || a.participant - b.participant);
}

export function winners(state: ExperimentState) {
  const ranking = competitionRanking(state);
  return ranking.filter((row) => row.score === ranking[0]?.score);
}

function randomIndex(count: number) {
  // Reject the incomplete interval so all ticket indices are equally likely.
  const range = 2 ** 32;
  const limit = range - range % count;
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % count;
}

export function drawCompetitionPrize(state: ExperimentState, pickIndex = randomIndex): PrizeDraw {
  const scores = competitionRanking(state);
  let rank = 0;
  let previousScore: number | undefined;
  const ranking = scores.map((row, index) => {
    if (row.score !== previousScore) rank += 1;
    previousScore = row.score;
    return {
      ...row,
      rank,
      tickets: scores.length - rank + 1,
      tied: scores[index - 1]?.score === row.score || scores[index + 1]?.score === row.score,
    };
  });

  const tickets = ranking.flatMap((row) => Array<number>(row.tickets).fill(row.participant));
  const winningTicket = pickIndex(tickets.length) + 1;
  return {
    drawnAt: new Date().toISOString(),
    prizeAmount: state.settings.prizeAmount,
    winnerParticipant: tickets[winningTicket - 1],
    winningTicket,
    totalTickets: tickets.length,
    rankingMethod: "shared_rank",
    ranking,
  };
}

export function prizeDrawNeedsUpdate(state: ExperimentState): boolean {
  const draw = state.prizeDraw;
  if (!draw) return false;
  return draw.ranking.length !== state.settings.participantCount
    || draw.ranking.some((row) => cumulativeTotal(state, row.participant) !== row.score);
}

export function finishCompetition(state: ExperimentState): ExperimentState {
  if (state.stage !== "competition" && !(state.stage === "practice" && state.prizeDraw)) return state;
  return { ...state, stage: "finished", prizeDrawPending: !state.prizeDraw };
}

export function awardCompetitionPrize(state: ExperimentState, pickIndex?: (count: number) => number): ExperimentState {
  if (state.stage !== "finished") return state;
  if (state.prizeDraw ? !prizeDrawNeedsUpdate(state) : !state.prizeDrawPending) return state;
  const prizeDraw = drawCompetitionPrize(state, pickIndex);
  return { ...state, prizeDrawPending: false, prizeDraw, updatedAt: prizeDraw.drawnAt };
}

export function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

// Three stations per heat. The array stores heat 1 followed by heat 2, etc.
export function practicePositionsFor(state: Pick<ExperimentState, "settings"> & { practicePositions?: number[] }) {
  const positions = state.practicePositions;
  const count = state.settings.participantCount;
  return Array.isArray(positions) && positions.length === count && new Set(positions).size === count
    && positions.every((participant) => Number.isInteger(participant) && participant >= 1 && participant <= count)
    ? positions : Array.from({ length: count }, (_, index) => index + 1);
}

export function practicePositionFor(state: ExperimentState, participant: number) {
  return practicePositionsFor(state).indexOf(participant) % 3 + 1;
}

export function practiceHeatFor(state: ExperimentState, participant: number) {
  return Math.floor(practicePositionsFor(state).indexOf(participant) / 3) + 1;
}

export function practiceHeatsFor(state: ExperimentState) {
  const positions = practicePositionsFor(state);
  return Array.from({ length: Math.ceil(positions.length / 3) }, (_, index) => positions.slice(index * 3, index * 3 + 3));
}

export function practiceTurnFor(state: ExperimentState, offset: number) {
  const positions = practicePositionsFor(state);
  const lastTurn = positions.length * state.settings.practiceRounds - 1;
  const current = (state.currentRound - 1) * positions.length + positions.indexOf(state.currentParticipant);
  const next = Math.max(0, Math.min(lastTurn, current + offset));
  const participant = positions[next % positions.length];
  const round = Math.floor(next / positions.length) + 1;
  return {
    participant, round, finished: current + offset > lastTurn,
    resetTimer: round !== state.currentRound || practiceHeatFor(state, participant) !== practiceHeatFor(state, state.currentParticipant),
  };
}

export function drawPracticePositions(count: number) {
  const positions = Array.from({ length: count }, (_, index) => index + 1);
  for (let index = count - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [positions[index], positions[other]] = [positions[other], positions[index]];
  }
  return positions;
}

export function normalizeState(candidate: Partial<ExperimentState>): ExperimentState {
  const base = createExperiment();
  const settings = { ...base.settings, ...(candidate.settings ?? {}) };
  const sessionCode = candidate.sessionCode && !candidate.sessionCode.startsWith("PH-")
    ? candidate.sessionCode
    : base.sessionCode;
  return {
    ...base,
    ...candidate,
    sessionCode,
    settings,
    timer: { ...base.timer, ...(candidate.timer ?? {}) },
    competitionScores: candidate.competitionScores ?? {},
    practiceScores: candidate.practiceScores ?? {},
    practicePositions: practicePositionsFor({ settings, practicePositions: candidate.practicePositions }),
  };
}
