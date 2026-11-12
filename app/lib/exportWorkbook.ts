import type { ExperimentState } from "./experiment";
import { competitionRanking, practiceHeatFor, practicePositionFor, practicePositionsFor, prizeDrawNeedsUpdate, roundTotal, throwsFor, total, winners } from "./experiment";
import { sessionTimingMetadata } from "./sessionTiming";

async function buildWorkbook(state: ExperimentState) {
  const savedAt = new Date();
  const XLSX = await import("xlsx");
  const competition: Record<string, string | number>[] = [];
  const practice: Record<string, string | number>[] = [];
  const allThrows: Record<string, string | number>[] = [];

  for (let participant = 1; participant <= state.settings.participantCount; participant += 1) {
    let cumulative = 0;
    for (let round = 1; round <= state.settings.competitionRounds; round += 1) {
      const hits = throwsFor(state.competitionScores, round, participant, state.settings.dartCount);
      const roundScore = total(hits);
      cumulative += roundScore;
      const row: Record<string, string | number> = {
        session_code: state.sessionCode,
        stage: "competition",
        participant,
        round,
        round_total: roundScore,
        cumulative_after_round: cumulative,
      };
      hits.forEach((hit, index) => {
        row[`dart_${index + 1}`] = hit;
        allThrows.push({
          session_code: state.sessionCode,
          stage: "competition",
          participant,
          round,
          dart: index + 1,
          score: hit,
          round_total: roundScore,
          cumulative_after_round: cumulative,
        });
      });
      competition.push(row);
    }

    for (let round = 1; round <= state.settings.practiceRounds; round += 1) {
      const hits = throwsFor(state.practiceScores, round, participant, state.settings.dartCount);
      const roundScore = total(hits);
      const row: Record<string, string | number> = {
        session_code: state.sessionCode,
        stage: "practice_private",
        practice_heat: practiceHeatFor(state, participant),
        practice_station: practicePositionFor(state, participant),
        participant,
        round,
        round_total: roundScore,
      };
      hits.forEach((hit, index) => {
        row[`dart_${index + 1}`] = hit;
        allThrows.push({
          session_code: state.sessionCode,
          stage: "practice_private",
          practice_heat: practiceHeatFor(state, participant),
          practice_station: practicePositionFor(state, participant),
          participant,
          round,
          dart: index + 1,
          score: hit,
          round_total: roundScore,
          cumulative_after_round: "",
        });
      });
      practice.push(row);
    }
  }

  const lastDraw = state.prizeDraw;
  const drawNeedsUpdate = prizeDrawNeedsUpdate(state);
  const draw = drawNeedsUpdate ? undefined : lastDraw;
  const ranking = draw?.ranking ?? competitionRanking(state).map((row, index) => ({
    ...row, rank: index + 1, tickets: "", tied: "",
  }));
  const legacyWinners = new Set(!lastDraw && state.stage === "finished" && !state.prizeDrawPending
    ? winners(state).map((row) => row.participant) : []);
  const summary = ranking.map((row) => {
    const won = lastDraw ? lastDraw.winnerParticipant === row.participant : legacyWinners.has(row.participant);
    return {
      session_code: state.sessionCode,
      rank: row.rank,
      participant: row.participant,
      competition_total: row.score,
      winner: won ? "yes" : "no",
      prize_ils: won ? (lastDraw?.prizeAmount ?? state.settings.prizeAmount) : 0,
      lottery_tickets: row.tickets,
      lottery_winner: lastDraw ? (won ? "yes" : "no") : "",
      lottery_tie_break: draw ? (row.tied && !draw.rankingMethod ? "yes" : "no") : "",
      lottery_tied: draw ? (row.tied ? "yes" : "no") : "",
      ...Object.fromEntries(Array.from({ length: state.settings.competitionRounds }, (_, roundIndex) => [
        `round_${roundIndex + 1}`,
        roundTotal(state, row.participant, roundIndex + 1),
      ])),
    };
  });

  const metadata = [
    { field: "experiment_name", value: "pothos" },
    { field: "session_code", value: state.sessionCode },
    { field: "experiment_id", value: state.id },
    { field: "created_at", value: state.createdAt },
    { field: "last_saved_at", value: savedAt.toISOString() },
    ...sessionTimingMetadata(state.createdAt, savedAt),
    { field: "stage_at_export", value: state.stage },
    { field: "participants", value: state.settings.participantCount },
    { field: "darts_per_round", value: state.settings.dartCount },
    { field: "practice_rounds", value: state.settings.practiceRounds },
    { field: "competition_rounds", value: state.settings.competitionRounds },
    { field: "duration_seconds", value: state.settings.durationSeconds },
    { field: "countdown_seconds", value: state.settings.countdownSeconds },
    { field: "maximum_score_per_dart", value: state.settings.maxScore },
    { field: "prize_ils_per_winner", value: lastDraw?.prizeAmount ?? state.settings.prizeAmount },
    { field: "prize_draw_status", value: drawNeedsUpdate ? "scores_updated" : draw ? "drawn" : state.stage === "finished" && !state.prizeDrawPending ? "legacy" : "pending" },
    { field: "prize_draw_at_utc", value: lastDraw?.drawnAt ?? "" },
    { field: "prize_draw_winning_ticket", value: lastDraw?.winningTicket ?? "" },
    { field: "prize_draw_total_tickets", value: lastDraw?.totalTickets ?? "" },
    { field: "prize_draw_ranking_method", value: lastDraw ? (lastDraw.rankingMethod ?? "random_tie_break") : "" },
    { field: "prize_draw_winner_participant", value: lastDraw?.winnerParticipant ?? "" },
    { field: "current_round_at_export", value: state.currentRound },
    { field: "current_participant_at_export", value: state.currentParticipant },
    { field: "notes_and_deviations", value: state.notes },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(competition), "Competition_rounds");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(practice), "Practice_private");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(allThrows), "All_throws_long");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadata), "Session_metadata");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(practicePositionsFor(state).map((participant, index) => ({
    session_code: state.sessionCode, practice_heat: Math.floor(index / 3) + 1, station: index % 3 + 1, practice_participant: participant, competition_station: index + 1, competition_participant: index + 1,
  }))), "Position_assignments");
  return { XLSX, workbook };
}

export async function workbookBytes(state: ExperimentState) {
  const { XLSX, workbook } = await buildWorkbook(state);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
}

export async function exportWorkbook(state: ExperimentState) {
  const { XLSX, workbook } = await buildWorkbook(state);
  XLSX.writeFile(workbook, `${state.sessionCode}.xlsx`, { compression: true });
}
