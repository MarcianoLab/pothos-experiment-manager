"use client";

import type { CSSProperties } from "react";
import { cumulativeTotal, roundTotal, scoreKey, winners } from "../lib/experiment";
import { useExperiment } from "../lib/useExperiment";

export default function Display() {
  const { state, hydrated } = useExperiment(true);
  if (!hydrated) return <main className="display-shell"><p className="display-instruction">מתחבר למסך הנסיין…</p></main>;

  const timerValue = state.timer.phase === "countdown" ? state.timer.countdownLeft : state.timer.secondsLeft;
  const showTimer = state.timer.phase !== "idle";
  const statusText = state.timer.phase === "countdown" ? "מתחילים בעוד…" : state.timer.phase === "running" ? "זמן זריקה" : state.timer.phase === "paused" ? "השעון נעצר" : state.timer.phase === "finished" ? "הזמן הסתיים" : "המתינו להוראת הנסיין";

  return <main className={`display-shell stage-${state.stage}`} dir="rtl">
    {state.stage === "setup" && <section className="display-center"><p className="display-kicker">ברוכים הבאים</p><h1>הניסוי יתחיל בקרוב</h1><p className="display-instruction">המתינו להוראות הנסיין</p></section>}

    {state.stage === "practice" && <section className="display-center practice-display"><p className="display-kicker">שלב האימון · סבב {state.currentRound} מתוך {state.settings.practiceRounds}</p><h1>{statusText}</h1>{showTimer && <div className="seconds-display"><div className={`display-timer ${timerValue <= 5 && state.timer.phase === "running" ? "urgent" : ""}`}>{timerValue}</div><span>שניות</span></div>}</section>}

    {state.stage === "competition" && <div className="competition-layout">
      <section className="competition-topline" aria-label="פרטי התור">
        <div className="competition-meta competition-name"><strong>תחרות הדיוק</strong></div>
        <div className="competition-meta current-shooter"><strong>משתתף בעמדה מספר #{state.currentParticipant}</strong></div>
        <div className="competition-meta"><span>סבב</span><strong>{state.currentRound} מתוך {state.settings.competitionRounds}</strong></div>
      </section>

      <section className="competition-clock">
        <p className="clock-status">{statusText}</p>
        <div className="seconds-display competition-seconds">
          <div className={`display-timer compact ${timerValue <= 5 && state.timer.phase === "running" ? "urgent" : ""}`}>{showTimer ? timerValue : state.settings.durationSeconds}</div>
          <span>שניות</span>
        </div>
      </section>

      <section className="scoreboard-panel">
        <div className="scoreboard-heading"><h2>תוצאות מצטברות</h2><span>המשתתף הפעיל מסומן בצהוב</span></div>
        <div className="participant-scores" style={{ "--score-columns": Math.min(state.settings.participantCount, state.settings.participantCount > 12 ? 5 : 3), "--score-rows": Math.ceil(state.settings.participantCount / (state.settings.participantCount > 12 ? 5 : 3)) } as CSSProperties}>{Array.from({ length: state.settings.participantCount }, (_, index) => {
          const participant = index + 1;
          const active = participant === state.currentParticipant;
          return <article key={participant} className={`participant-score-card${active ? " current" : ""}`} aria-label={`משתתף ${participant}${active ? ", בתור עכשיו" : ""}`}>
            <div className="participant-score-heading"><h3>משתתף <bdi>#{participant}</bdi></h3>{active && <span>בתור עכשיו</span>}</div>
            <div className="participant-score-total"><strong>{cumulativeTotal(state, participant)}</strong><span>נקודות מצטברות</span></div>
            <dl className="participant-round-scores" aria-label="ניקוד לפי סבב">{Array.from({ length: state.settings.competitionRounds }, (_, roundIndex) => {
              const round = roundIndex + 1;
              const recorded = Object.hasOwn(state.competitionScores, scoreKey(round, participant));
              return <div key={round}><dt>סבב {round}</dt><dd>{recorded ? roundTotal(state, participant, round) : <span aria-label="טרם הוזן ניקוד">—</span>}</dd></div>;
            })}</dl>
          </article>;
        })}</div>
      </section>
    </div>}

    {state.stage === "finished" && <section className="display-center"><p className="display-kicker">התחרות הסתיימה</p><h1>{winners(state).length > 1 ? "הזוכים בתחרות" : "הזוכה בתחרות"}</h1><div className="display-winners">{winners(state).map((row) => <span key={row.participant}>#{row.participant}</span>)}</div><p className="display-instruction">{winners(state)[0]?.score ?? 0} נקודות · תוספת של {state.settings.prizeAmount} ₪ לכל זוכה</p></section>}
  </main>;
}
