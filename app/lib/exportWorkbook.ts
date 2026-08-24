import type { ExperimentState } from "./experiment";
import { cumulativeTotal, roundTotal, throwsFor, total, winners } from "./experiment";

export async function exportWorkbook(state: ExperimentState) {
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
        participant,
        round,
        round_total: roundScore,
      };
      hits.forEach((hit, index) => {
        row[`dart_${index + 1}`] = hit;
        allThrows.push({
          session_code: state.sessionCode,
          stage: "practice_private",
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

  const ranking = Array.from({ length: state.settings.participantCount }, (_, index) => ({
    participant: index + 1,
    total: cumulativeTotal(state, index + 1),
  })).sort((a, b) => b.total - a.total || a.participant - b.participant);
  const winningParticipants = new Set(winners(state).map((row) => row.participant));
  const summary = ranking.map((row, index) => ({
    session_code: state.sessionCode,
    rank: index + 1,
    participant: row.participant,
    competition_total: row.total,
    winner: winningParticipants.has(row.participant) ? "yes" : "no",
    prize_ils: winningParticipants.has(row.participant) ? state.settings.prizeAmount : 0,
    ...Object.fromEntries(Array.from({ length: state.settings.competitionRounds }, (_, roundIndex) => [
      `round_${roundIndex + 1}`,
      roundTotal(state, row.participant, roundIndex + 1),
    ])),
  }));

  const metadata = [
    { field: "experiment_name", value: "pothos" },
    { field: "session_code", value: state.sessionCode },
    { field: "experiment_id", value: state.id },
    { field: "created_at", value: state.createdAt },
    { field: "last_saved_at", value: state.updatedAt },
    { field: "stage_at_export", value: state.stage },
    { field: "participants", value: state.settings.participantCount },
    { field: "darts_per_round", value: state.settings.dartCount },
    { field: "practice_rounds", value: state.settings.practiceRounds },
    { field: "competition_rounds", value: state.settings.competitionRounds },
    { field: "duration_seconds", value: state.settings.durationSeconds },
    { field: "countdown_seconds", value: state.settings.countdownSeconds },
    { field: "maximum_score_per_dart", value: state.settings.maxScore },
    { field: "prize_ils_per_winner", value: state.settings.prizeAmount },
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
  XLSX.writeFile(workbook, `${state.sessionCode}.xlsx`, { compression: true });
}
