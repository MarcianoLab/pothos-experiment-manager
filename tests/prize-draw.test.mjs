import assert from "node:assert/strict";
import test from "node:test";
import { awardCompetitionPrize, createExperiment, drawCompetitionPrize, finishCompetition, normalizeState, prizeDrawNeedsUpdate } from "../app/lib/experiment.ts";

test("each of the 21 possible tickets resolves to the expected participant", () => {
  const state = createExperiment();
  state.competitionScores = Object.fromEntries(
    [1, 6, 2, 5, 3, 4].map((score, i) => [`1-${i + 1}`, [score]]),
  );
  const expected = [2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 5, 5, 5, 3, 3, 1];
  for (const [index, participant] of expected.entries()) {
    const draw = drawCompetitionPrize(state, (count) => {
      assert.equal(count, 21);
      return index;
    });
    assert.equal(draw.winnerParticipant, participant);
    assert.equal(draw.winningTicket, index + 1);
    assert.equal(draw.prizeAmount, 10);
    assert.deepEqual(draw.ranking.map((row) => row.tickets), [6, 5, 4, 3, 2, 1]);
  }
});

test("a tie for second shares five tickets and leaves two tickets for last place", () => {
  const state = createExperiment();
  state.competitionScores = Object.fromEntries(
    [9, 8, 8, 7, 6, 5].map((score, i) => [`1-${i + 1}`, [score]]),
  );
  const calls = [];
  const draw = drawCompetitionPrize(state, (count) => {
    calls.push(count);
    return count - 1;
  });
  assert.deepEqual(calls, [25]);
  assert.deepEqual(draw.ranking.map((row) => row.rank), [1, 2, 2, 3, 4, 5]);
  assert.deepEqual(draw.ranking.map((row) => row.tickets), [6, 5, 5, 4, 3, 2]);
  assert.deepEqual(draw.ranking.map((row) => row.tied), [false, true, true, false, false, false]);
  assert.equal(draw.winningTicket, 25);
  assert.equal(draw.winnerParticipant, 6);
  assert.equal(draw.rankingMethod, "shared_rank");
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify({ ...state, prizeDraw: draw }))).prizeDraw, draw);
});

test("multiple ties share the appropriate places and ticket counts", () => {
  const state = createExperiment();
  state.competitionScores = Object.fromEntries(
    [8, 8, 6, 4, 4, 1].map((score, i) => [`1-${i + 1}`, [score]]),
  );
  const draw = drawCompetitionPrize(state, () => 0);
  assert.deepEqual(draw.ranking.map((row) => row.rank), [1, 1, 2, 3, 3, 4]);
  assert.deepEqual(draw.ranking.map((row) => row.tickets), [6, 6, 5, 4, 4, 3]);
  assert.equal(draw.totalTickets, 28);
});

test("the same ranked allocation works with a configured nonstandard group size", () => {
  const state = createExperiment();
  state.settings = { ...state.settings, participantCount: 3 };
  state.competitionScores = { "1-1": [3], "1-2": [2], "1-3": [1] };
  const draw = drawCompetitionPrize(state, (count) => count - 1);
  assert.equal(draw.totalTickets, 6);
  assert.equal(draw.winnerParticipant, 3);
  assert.deepEqual(draw.ranking.map((row) => row.tickets), [3, 2, 1]);
});

test("finishing leaves the draw pending until the operator explicitly awards the prize", () => {
  const state = { ...createExperiment(), stage: "competition" };
  const pick = () => assert.fail("No draw should happen in this state");
  assert.equal(awardCompetitionPrize(state, pick), state);

  const pending = finishCompetition(state);
  assert.equal(pending.stage, "finished");
  assert.equal(pending.prizeDrawPending, true);
  assert.equal(pending.prizeDraw, undefined);

  const restored = normalizeState(JSON.parse(JSON.stringify(pending)));
  const drawn = awardCompetitionPrize(restored, () => 0);
  assert.equal(drawn.prizeDrawPending, false);
  assert.equal(drawn.prizeDraw.totalTickets, 36);
  assert.deepEqual(drawn.prizeDraw.ranking.map((row) => row.tickets), [6, 6, 6, 6, 6, 6]);
  assert.equal(awardCompetitionPrize(drawn, pick), drawn);

  const legacy = { ...state, stage: "finished" };
  assert.equal(awardCompetitionPrize(legacy, pick), legacy);
});


test("the saved draw stays valid after practice corrections and can be replaced after competition corrections", () => {
  const session = { ...createExperiment(), stage: "competition" };
  session.competitionScores = { "1-1": [6], "1-2": [4] };
  const drawn = awardCompetitionPrize(finishCompetition(session), () => 0);
  const noDraw = () => assert.fail("The existing draw should be kept");

  const practice = finishCompetition({
    ...drawn,
    stage: "practice",
    practiceScores: { "1-1": [10] },
  });
  assert.equal(practice.stage, "finished");
  assert.equal(practice.prizeDraw, drawn.prizeDraw);
  assert.equal(prizeDrawNeedsUpdate(practice), false);
  assert.equal(awardCompetitionPrize(practice, noDraw), practice);

  const correction = { ...practice, stage: "competition", competitionScores: { "1-1": [6], "1-2": [8] } };
  assert.equal(awardCompetitionPrize(correction, noDraw), correction);
  const finished = normalizeState(JSON.parse(JSON.stringify(finishCompetition(correction))));
  assert.equal(prizeDrawNeedsUpdate(finished), true);
  assert.equal(finished.prizeDraw.winnerParticipant, 1);

  const redrawn = awardCompetitionPrize(finished, () => 0);
  assert.equal(redrawn.prizeDraw.winnerParticipant, 2);
  assert.equal(prizeDrawNeedsUpdate(redrawn), false);
  assert.equal(awardCompetitionPrize(redrawn, noDraw), redrawn);
});
