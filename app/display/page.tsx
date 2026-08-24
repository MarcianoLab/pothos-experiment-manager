"use client";

import { cumulativeTotal, roundTotal, winners } from "../lib/experiment";
import { useExperiment } from "../lib/useExperiment";

export default function Display() {
  const { state, hydrated } = useExperiment(true);
  if (!hydrated) return <main className="display-shell"><p className="display-instruction">מתחבר למסך הנסיין…</p></main>;
  const timerValue = state.timer.phase === "countdown" ? state.timer.countdownLeft : state.timer.secondsLeft;
  const activeTimer = state.timer.phase === "countdown" || state.timer.phase === "running" || state.timer.phase === "finished";
  return <main className={`display-shell stage-${state.stage}`} dir="rtl">
    <header className="display-header"><span>תחרות הדיוק</span><span>{state.sessionCode}</span></header>
    {state.stage === "setup" && <section className="display-center"><p className="display-kicker">ברוכים הבאים</p><h1>הניסוי יתחיל בקרוב</h1><div className="target-mark"><i /><i /><i /></div><p className="display-instruction">המתינו להוראות הנסיין</p></section>}
    {state.stage === "practice" && <section className="display-center"><p className="display-kicker">שלב האימון · סבב {state.currentRound}</p><h1>{state.timer.phase === "countdown" ? "מתכוננים לזריקה" : state.timer.phase === "running" ? "זרקו עכשיו" : state.timer.phase === "finished" ? "הזמן הסתיים" : "המתינו להוראה"}</h1>{activeTimer && <div className={`display-timer ${timerValue <= 5 && state.timer.phase === "running" ? "urgent" : ""}`}>{timerValue}</div>}<p className="display-instruction">תוצאות האימון אינן מוצגות</p></section>}
    {state.stage === "competition" && <>
      <section className="competition-banner"><div><p className="display-kicker">סבב {state.currentRound}</p><h1>משתתף מספר {state.currentParticipant}</h1></div><div className={`display-timer compact ${timerValue <= 5 && state.timer.phase === "running" ? "urgent" : ""}`}>{activeTimer ? timerValue : state.settings.durationSeconds}</div><p className="display-instruction">{state.timer.phase === "countdown" ? "מתחילים בעוד…" : state.timer.phase === "running" ? "זמן זריקה" : state.timer.phase === "finished" ? "הזמן הסתיים" : "המתינו להוראת הנסיין"}</p></section>
      <section className="public-results"><table><thead><tr><th>משתתף</th>{Array.from({ length: state.settings.competitionRounds }, (_, i) => <th key={i}>סבב {i + 1}</th>)}<th>סה״כ</th></tr></thead><tbody>{Array.from({ length: state.settings.participantCount }, (_, p) => <tr key={p} className={p + 1 === state.currentParticipant ? "current" : ""}><th>#{p + 1}</th>{Array.from({ length: state.settings.competitionRounds }, (_, r) => <td key={r}>{roundTotal(state, p + 1, r + 1)}</td>)}<td>{cumulativeTotal(state, p + 1)}</td></tr>)}</tbody></table></section>
    </>}
    {state.stage === "finished" && <section className="display-center"><p className="display-kicker">התחרות הסתיימה</p><h1>{winners(state).length > 1 ? "הזוכים בתחרות" : "הזוכה בתחרות"}</h1><div className="display-winners">{winners(state).map((row) => <span key={row.participant}>#{row.participant}</span>)}</div><p className="display-instruction">{winners(state)[0]?.score ?? 0} נקודות · תוספת של {state.settings.prizeAmount} ₪ לכל זוכה</p></section>}
  </main>;
}
