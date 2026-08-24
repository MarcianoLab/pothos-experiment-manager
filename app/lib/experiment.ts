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
  notes: string;
};

export const STORAGE_KEY = "photos-experiment-state-v1";
export const CHANNEL_NAME = "photos-experiment-live";

export const defaultSettings: Settings = {
  participantCount: 6,
  dartCount: 5,
  practiceRounds: 4,
  competitionRounds: 4,
  durationSeconds: 15,
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
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `PH-${day}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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

export function winners(state: ExperimentState) {
  const totals = Array.from({ length: state.settings.participantCount }, (_, index) => ({
    participant: index + 1,
    score: cumulativeTotal(state, index + 1),
  }));
  const best = Math.max(...totals.map((row) => row.score), 0);
  return totals.filter((row) => row.score === best);
}

export function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function normalizeState(candidate: Partial<ExperimentState>): ExperimentState {
  const base = createExperiment();
  const settings = { ...base.settings, ...(candidate.settings ?? {}) };
  return {
    ...base,
    ...candidate,
    settings,
    timer: { ...base.timer, ...(candidate.timer ?? {}) },
    competitionScores: candidate.competitionScores ?? {},
    practiceScores: candidate.practiceScores ?? {},
  };
}
