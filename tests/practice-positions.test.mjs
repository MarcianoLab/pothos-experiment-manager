import assert from 'node:assert/strict';
import test from 'node:test';
import { createExperiment, drawPracticePositions, normalizeState, practicePositionFor, practiceHeatFor, practiceHeatsFor, practiceTurnFor, practicePositionsFor, cumulativeTotal } from '../app/lib/experiment.ts';

test('draw assigns every participant exactly once across all stations', () => {
  for (const count of [1, 6, 12, 30]) {
    for (let draw = 0; draw < 100; draw++) {
      assert.deepEqual(drawPracticePositions(count).sort((a, b) => a - b), Array.from({length: count}, (_, i) => i + 1));
    }
  }
});

test('station assignments survive restore and keep participant scores attached to identity', () => {
  const state = createExperiment();
  state.practicePositions = [2, 3, 4, 5, 6, 1];
  state.practiceScores = {'1-1': [7]};
  state.competitionScores = {'1-1': [10]};
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(practicePositionFor(restored, 1), 3);
  assert.equal(practiceHeatFor(restored, 1), 2);
  assert.deepEqual(restored.practiceScores['1-1'], [7]);
  restored.stage = 'competition';
  assert.equal(cumulativeTotal(restored, 1), 10);
  assert.equal(cumulativeTotal(restored, 6), 0);
  assert.deepEqual(restored.practicePositions, state.practicePositions);
});

test('two heats have three stations and station 2 resolves to participant 4', () => {
  const state = createExperiment();
  state.settings = { ...state.settings, practiceRounds: 2 };
  state.practicePositions = [2, 4, 6, 1, 3, 5];
  assert.deepEqual(practiceHeatsFor(state), [[2, 4, 6], [1, 3, 5]]);
  assert.equal(practiceHeatFor(state, 4), 1);
  assert.equal(practicePositionFor(state, 4), 2);
  state.currentParticipant = 2;
  assert.deepEqual(practiceTurnFor(state, 1), {participant: 4, round: 1, finished: false, resetTimer: false});
  state.currentParticipant = 6;
  assert.deepEqual(practiceTurnFor(state, 1), {participant: 1, round: 1, finished: false, resetTimer: true});
  state.currentParticipant = 1;
  assert.deepEqual(practiceTurnFor(state, -1), {participant: 6, round: 1, finished: false, resetTimer: true});
  state.currentParticipant = 5;
  assert.deepEqual(practiceTurnFor(state, 1), {participant: 2, round: 2, finished: false, resetTimer: true});
  state.currentRound = state.settings.practiceRounds;
  assert.equal(practiceTurnFor(state, 1).finished, true);
});

test('old sessions and invalid or resized assignments receive valid default stations', () => {
  const state = createExperiment();
  for (const practicePositions of [undefined, [], [1, 1, 3, 4, 5, 6], [1, 2, 3, 4, 5, 7]]) {
    assert.deepEqual(normalizeState({...state, practicePositions}).practicePositions, [1, 2, 3, 4, 5, 6]);
  }
  assert.deepEqual(practicePositionsFor({...state, settings: {...state.settings, participantCount: 3}}), [1, 2, 3]);
});
