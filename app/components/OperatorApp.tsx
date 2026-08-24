"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExperimentState, Settings, Stage } from "../lib/experiment";
import {
  clampInteger,
  createExperiment,
  cumulativeTotal,
  normalizeState,
  roundTotal,
  scoreKey,
  throwsFor,
  total,
  winners,
} from "../lib/experiment";
import { exportWorkbook } from "../lib/exportWorkbook";
import { useExperiment } from "../lib/useExperiment";

type Tab = "run" | "scores" | "practice" | "settings";

const DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/13dk3HXybtUQ5-kj0t55Ggj5wXN-R89qo";
const stageLabels: Record<Stage, string> = {
  setup: "לפני ההתחלה",
  practice: "אימון",
  competition: "תחרות סדרתית",
  finished: "סיום התחרות",
};

const hebrewNumbers: Record<number, string> = {
  1: "אחת", 2: "שתיים", 3: "שלוש", 4: "ארבע", 5: "חמש",
  6: "שש", 7: "שבע", 8: "שמונה", 9: "תשע", 10: "עשר",
};

function speakHebrew(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "he-IL";
  utterance.rate = 1;
  utterance.volume = 1;
  const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("he"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function freshTimer(current: ExperimentState) {
  return {
    phase: "idle" as const,
    secondsLeft: current.settings.durationSeconds,
    countdownLeft: current.settings.countdownSeconds,
    endAt: null,
    pausedPhase: undefined,
  };
}

function TimerControls({ state, setState }: {
  state: ExperimentState;
  setState: React.Dispatch<React.SetStateAction<ExperimentState>>;
}) {
  const { timer, settings } = state;
  const active = timer.phase === "running" || timer.phase === "countdown";

  const start = () => setState((current) => {
    if (current.timer.phase === "paused") {
      const resumedPhase = current.timer.pausedPhase ?? "running";
      const remaining = resumedPhase === "countdown" ? current.timer.countdownLeft : current.timer.secondsLeft;
      return {
        ...current,
        timer: { ...current.timer, phase: resumedPhase, endAt: Date.now() + remaining * 1000 },
      };
    }
    return {
      ...current,
      timer: {
        phase: current.settings.countdownSeconds > 0 ? "countdown" : "running",
        countdownLeft: current.settings.countdownSeconds,
        secondsLeft: current.settings.durationSeconds,
        endAt: Date.now() + (current.settings.countdownSeconds > 0 ? current.settings.countdownSeconds : current.settings.durationSeconds) * 1000,
        pausedPhase: undefined,
      },
    };
  });

  const pause = () => setState((current) => {
    if (current.timer.phase !== "running" && current.timer.phase !== "countdown") return current;
    return {
      ...current,
      timer: {
        ...current.timer,
        phase: "paused",
        pausedPhase: current.timer.phase,
        endAt: null,
      },
    };
  });

  const reset = () => {
    window.speechSynthesis?.cancel();
    setState((current) => ({ ...current, timer: freshTimer(current) }));
  };

  const timerText = timer.phase === "countdown" ? timer.countdownLeft : timer.secondsLeft;
  const caption = timer.phase === "countdown" ? "ספירה לאחור" : timer.phase === "running" ? "זמן זריקה" : timer.phase === "paused" ? "השעון נעצר" : timer.phase === "finished" ? "הזמן הסתיים" : "מוכן להפעלה";

  return <>
    <div className={`timer-preview ${timer.secondsLeft <= 5 && timer.phase === "running" ? "urgent" : ""}`}>{timerText}</div>
    <p className="timer-caption">{caption}</p>
    <div className="button-row">
      <button className="primary" onClick={start} disabled={active}>
        {timer.phase === "paused" ? "המשך זמן הזריקה" : "התחלת זמן הזריקה"}
      </button>
      <button className="danger" onClick={pause} disabled={!active}>עצירת השעון</button>
      <button className="ghost-on-dark" onClick={reset}>איפוס</button>
    </div>
  </>;
}

function ScoreEditor({ state, setState, practice = false, round, participant, onComplete }: {
  state: ExperimentState;
  setState: React.Dispatch<React.SetStateAction<ExperimentState>>;
  practice?: boolean;
  round: number;
  participant: number;
  onComplete?: () => void;
}) {
  const source = practice ? state.practiceScores : state.competitionScores;
  const values = throwsFor(source, round, participant, state.settings.dartCount);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const advanceTimeout = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRefs.current[0]?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [round, participant]);

  const moveForward = (index: number) => {
    if (index < state.settings.dartCount - 1) {
      inputRefs.current[index + 1]?.focus();
    } else {
      onComplete?.();
    }
  };

  const updateThrow = (index: number, raw: string) => {
    if (advanceTimeout.current) window.clearTimeout(advanceTimeout.current);
    const value = clampInteger(Number(raw), 0, state.settings.maxScore);
    setState((current) => {
      const scores = practice ? current.practiceScores : current.competitionScores;
      const next = throwsFor(scores, round, participant, current.settings.dartCount);
      next[index] = value;
      return practice
        ? { ...current, practiceScores: { ...scores, [scoreKey(round, participant)]: next } }
        : { ...current, competitionScores: { ...scores, [scoreKey(round, participant)]: next } };
    });

    if (raw === "1" && state.settings.maxScore >= 10) {
      advanceTimeout.current = window.setTimeout(() => moveForward(index), 450);
    } else if (raw !== "") {
      advanceTimeout.current = window.setTimeout(() => moveForward(index), 80);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (advanceTimeout.current) window.clearTimeout(advanceTimeout.current);
      moveForward(index);
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowRight") && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }
  };

  return <div>
    <div className="panel-heading score-heading">
      <div>
        <p className="panel-label">{practice ? "תוצאות אימון פרטיות" : "הזנת תוצאה"}</p>
        <h2>סבב {round} · משתתף {participant}</h2>
      </div>
      <strong className="score-total">סה״כ {total(values)}</strong>
    </div>
    <div className="dart-grid">
      {values.map((value, index) => <label key={index}>
        חץ {index + 1}
        <input
          ref={(element) => { inputRefs.current[index] = element; }}
          aria-label={`חץ ${index + 1}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={state.settings.maxScore}
          value={value}
          onChange={(event) => updateThrow(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>)}
    </div>
    <p className="keyboard-hint">הקלדת ציון מעבירה לחץ הבא. לציון 10 הקלידו 1 ואז 0. Enter עובר קדימה, והחצים עוברים בין השדות.</p>
    {practice && <p className="privacy-note">אזור זה פרטי לנסיין ואינו מופיע במסך המשתתפים.</p>}
  </div>;
}

function Leaderboard({ state, chooseScore }: { state: ExperimentState; chooseScore?: (participant: number, round: number) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>משתתף</th>{Array.from({ length: state.settings.competitionRounds }, (_, index) => <th key={index}>סבב {index + 1}</th>)}<th>מצטבר</th></tr></thead><tbody>
    {Array.from({ length: state.settings.participantCount }, (_, participantIndex) => {
      const participant = participantIndex + 1;
      return <tr key={participant}><th>#{participant}</th>{Array.from({ length: state.settings.competitionRounds }, (_, roundIndex) => {
        const round = roundIndex + 1;
        const score = roundTotal(state, participant, round);
        return <td key={round}>{chooseScore ? <button className="cell-button" onClick={() => chooseScore(participant, round)}>{score}</button> : score}</td>;
      })}<td className="cumulative">{cumulativeTotal(state, participant)}</td></tr>;
    })}
  </tbody></table></div>;
}

export default function OperatorApp() {
  const { state, setState, replaceState, hydrated, saveStatus } = useExperiment();
  const [tab, setTab] = useState<Tab>("settings");
  const [practiceRound, setPracticeRound] = useState(1);
  const [practiceParticipant, setPracticeParticipant] = useState(1);
  const [restoreMessage, setRestoreMessage] = useState("");
  const lastAnnouncement = useRef("");

  useEffect(() => {
    if (state.timer.phase !== "countdown" && state.timer.phase !== "running") return;
    const tick = () => setState((current) => {
      if (!current.timer.endAt) return current;
      const remaining = Math.max(0, Math.ceil((current.timer.endAt - Date.now()) / 1000));
      if (current.timer.phase === "countdown") {
        if (remaining > 0 && remaining === current.timer.countdownLeft) return current;
        if (remaining > 0) return { ...current, timer: { ...current.timer, countdownLeft: remaining } };
        return {
          ...current,
          timer: {
            phase: "running",
            countdownLeft: 0,
            secondsLeft: current.settings.durationSeconds,
            endAt: Date.now() + current.settings.durationSeconds * 1000,
            pausedPhase: undefined,
          },
        };
      }
      if (remaining === current.timer.secondsLeft) return current;
      if (remaining > 0) return { ...current, timer: { ...current.timer, secondsLeft: remaining } };
      return { ...current, timer: { ...current.timer, phase: "finished", secondsLeft: 0, endAt: null, pausedPhase: undefined } };
    });
    tick();
    const interval = window.setInterval(tick, 120);
    return () => window.clearInterval(interval);
  }, [state.timer.phase, setState]);

  useEffect(() => {
    const { timer } = state;
    const key = `${timer.phase}-${timer.phase === "countdown" ? timer.countdownLeft : timer.secondsLeft}`;
    if (lastAnnouncement.current === key) return;
    lastAnnouncement.current = key;
    if (timer.phase === "countdown" && timer.countdownLeft > 0) speakHebrew(hebrewNumbers[timer.countdownLeft] ?? String(timer.countdownLeft));
    if (timer.phase === "running" && timer.secondsLeft === state.settings.durationSeconds) speakHebrew("התחילו");
    else if (timer.phase === "running" && timer.secondsLeft <= 3 && timer.secondsLeft > 0) speakHebrew(hebrewNumbers[timer.secondsLeft]);
    if (timer.phase === "finished") speakHebrew("הזמן הסתיים");
  }, [state.timer, state.settings.durationSeconds]);

  const currentValues = useMemo(() => throwsFor(state.competitionScores, state.currentRound, state.currentParticipant, state.settings.dartCount), [state]);

  const changeStage = (stage: Stage) => setState((current) => ({
    ...current,
    stage,
    currentParticipant: 1,
    currentRound: 1,
    timer: freshTimer(current),
  }));

  const beginPractice = () => {
    changeStage(state.settings.practiceRounds > 0 ? "practice" : "competition");
    setTab("run");
  };

  const finishCompetition = () => setState((current) => {
    const finished = { ...current, stage: "finished" as const, timer: freshTimer(current) };
    window.setTimeout(() => exportWorkbook(finished), 0);
    return finished;
  });

  const nextCompetitionTurn = () => setState((current) => {
    if (current.currentParticipant === current.settings.participantCount && current.currentRound === current.settings.competitionRounds) {
      const finished = { ...current, stage: "finished" as const, timer: freshTimer(current) };
      window.setTimeout(() => exportWorkbook(finished), 0);
      return finished;
    }
    let participant = current.currentParticipant + 1;
    let round = current.currentRound;
    if (participant > current.settings.participantCount) {
      participant = 1;
      round += 1;
    }
    return { ...current, currentParticipant: participant, currentRound: round, timer: freshTimer(current) };
  });

  const nextPracticeRound = () => setState((current) => {
    if (current.currentRound >= current.settings.practiceRounds) {
      return { ...current, stage: "competition", currentRound: 1, currentParticipant: 1, timer: freshTimer(current) };
    }
    return { ...current, currentRound: current.currentRound + 1, timer: freshTimer(current) };
  });

  const nextPrivatePractice = () => {
    if (practiceParticipant < state.settings.participantCount) {
      setPracticeParticipant(practiceParticipant + 1);
    } else if (practiceRound < state.settings.practiceRounds) {
      setPracticeParticipant(1);
      setPracticeRound(practiceRound + 1);
    }
  };

  const updateSetting = (key: keyof Settings, value: number) => setState((current) => {
    const settings = { ...current.settings, [key]: value };
    return { ...current, settings, timer: { ...current.timer, secondsLeft: settings.durationSeconds, countdownLeft: settings.countdownSeconds } };
  });

  const newSession = () => {
    if (!window.confirm("לפתוח הרצה חדשה? מומלץ להוריד קודם את קובץ ה-Excel של ההרצה הנוכחית.")) return;
    replaceState(createExperiment());
    setTab("settings");
  };

  const restoreFromLiveBackup = async () => {
    setRestoreMessage("מחפש את ההרצה בגיבוי החי…");
    try {
      const response = await fetch(`/api/experiments?sessionCode=${encodeURIComponent(state.sessionCode)}`);
      if (!response.ok) throw new Error("not found");
      const data = await response.json() as { experiment: ExperimentState };
      replaceState(normalizeState(data.experiment));
      setRestoreMessage("ההרצה שוחזרה בהצלחה.");
    } catch {
      setRestoreMessage("לא נמצאה הרצה בענן עם קוד זה.");
    }
  };

  if (!hydrated) return <main className="loading-screen">טוען את נתוני ההרצה…</main>;

  const saveLabels = {
    local: "נשמר במחשב",
    syncing: "מעדכן גיבוי חי…",
    cloud: "גיבוי חי מעודכן",
    offline: "אין אינטרנט · נשמר במחשב",
  };
  const practiceActionLabel = state.currentRound >= state.settings.practiceRounds ? "סיום האימון ומעבר לתחרות" : "סיום הסבב ומעבר לסבב הבא";

  return <main className="operator-shell" dir="rtl">
    <header className="topbar">
      <div><p className="eyebrow">מערכת ניהול ניסוי · {state.sessionCode}</p><h1>Pothos · תחרות הדיוק</h1></div>
      <div className="top-actions"><span className={`sync-badge ${saveStatus}`}><i />{saveLabels[saveStatus]}</span><button className="secondary" onClick={() => window.open("/display", "pothos-display", "popup=yes")}>פתיחת מסך המשתתפים</button></div>
    </header>

    <nav className="tabs" aria-label="אזורים במערכת">
      <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>הגדרות ויצוא</button>
      <button className={tab === "run" ? "active" : ""} onClick={() => setTab("run")}>ניהול הניסוי</button>
      <button className={tab === "scores" ? "active" : ""} onClick={() => setTab("scores")}>טבלת תוצאות</button>
      <button className={tab === "practice" ? "active" : ""} onClick={() => setTab("practice")}>אימון פרטי</button>
    </nav>

    {tab === "run" && <>
      <section className="stage-strip three-stages">
        {(["practice", "competition", "finished"] as Stage[]).map((stage) => <button key={stage} className={state.stage === stage ? "active" : ""} onClick={() => stage === "finished" ? finishCompetition() : changeStage(stage)}>{stageLabels[stage]}</button>)}
      </section>

      {state.stage !== "finished" ? <>
        <section className="status-grid compact-status">
          <article className="hero-card compact-hero">
            <span className="pill">{stageLabels[state.stage]}</span>
            <h2>{state.stage === "practice" ? `סבב אימון ${state.currentRound}` : state.stage === "competition" ? `סבב ${state.currentRound} · משתתף ${state.currentParticipant}` : "הניסוי טרם התחיל"}</h2>
            <TimerControls state={state} setState={setState} />
          </article>
          <article className="panel compact-panel">
            {state.stage === "practice" ? <>
              <p className="panel-label">התקדמות באימון</p>
              <div className="phase-number"><strong>{state.currentRound}</strong><span>מתוך {state.settings.practiceRounds} סבבים</span></div>
              <button className="primary wide" onClick={nextPracticeRound}>{practiceActionLabel}</button>
            </> : state.stage === "competition" ? <>
              <p className="panel-label">בקרת התור</p>
              <div className="control-selects">
                <label className="inline-select">סבב<select value={state.currentRound} onChange={(event) => setState((current) => ({ ...current, currentRound: Number(event.target.value), timer: freshTimer(current) }))}>{Array.from({ length: state.settings.competitionRounds }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
                <label className="inline-select">משתתף<select value={state.currentParticipant} onChange={(event) => setState((current) => ({ ...current, currentParticipant: Number(event.target.value), timer: freshTimer(current) }))}>{Array.from({ length: state.settings.participantCount }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
              </div>
              <div className="current-score"><span>הניקוד בתור</span><strong>{total(currentValues)}</strong></div>
              <button className="secondary wide" onClick={nextCompetitionTurn}>{state.currentParticipant === state.settings.participantCount && state.currentRound === state.settings.competitionRounds ? "סיום התחרות" : "מעבר לתור הבא"}</button>
            </> : <>
              <p className="panel-label">לפני ההתחלה</p><h2>יש לאשר תחילה את ההגדרות</h2><button className="primary wide" onClick={() => setTab("settings")}>מעבר להגדרות</button>
            </>}
          </article>
        </section>
        {state.stage === "competition" && <section className="panel score-panel"><ScoreEditor state={state} setState={setState} round={state.currentRound} participant={state.currentParticipant} onComplete={nextCompetitionTurn} /></section>}
      </> : <>
        <section className="hero-card finished-hero"><span className="pill">התחרות הסתיימה</span><div className="winner-block"><p>{winners(state).length > 1 ? "הזוכים בתחרות" : "הזוכה בתחרות"}</p><strong>{winners(state).map((row) => `#${row.participant}`).join(", ")}</strong><span>{winners(state)[0]?.score ?? 0} נקודות</span></div></section>
        <section className="panel finish-actions"><button className="primary" onClick={() => exportWorkbook(state)}>הורדת Excel מלא</button><a className="secondary button-link" href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">פתיחת תיקיית Google Drive</a><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></section>
      </>}
    </>}

    {tab === "scores" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">תוצאות התחרות</p><h2>טבלה מצטברת</h2></div><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel מלא</button></div><Leaderboard state={state} chooseScore={(participant, round) => { setState((current) => ({ ...current, currentParticipant: participant, currentRound: round, stage: "competition", timer: freshTimer(current) })); setTab("run"); }} /></section>}

    {tab === "practice" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">אינו מוקרן למשתתפים</p><h2>תיעוד אימון בזמן אמת או בדיעבד</h2></div><div className="selector-row"><label>סבב<select value={practiceRound} onChange={(event) => setPracticeRound(Number(event.target.value))}>{Array.from({ length: state.settings.practiceRounds }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label><label>משתתף<select value={practiceParticipant} onChange={(event) => setPracticeParticipant(Number(event.target.value))}>{Array.from({ length: state.settings.participantCount }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label></div></div><ScoreEditor state={state} setState={setState} practice round={practiceRound} participant={practiceParticipant} onComplete={nextPrivatePractice} /></section>}

    {tab === "settings" && <section className="settings-grid">
      <article className="panel"><p className="panel-label">בדיקה לפני ההתחלה</p><h2>מבנה הניסוי</h2><div className="form-grid">{([
        ["participantCount", "מספר משתתפים", 1, 30], ["dartCount", "חצים בסבב", 1, 20], ["practiceRounds", "סבבי אימון", 0, 20], ["competitionRounds", "סבבי תחרות", 1, 20],
        ["durationSeconds", "זמן זריקה בשניות", 3, 120], ["countdownSeconds", "ספירה לאחור", 0, 10], ["maxScore", "ניקוד מרבי לחץ", 1, 100], ["prizeAmount", "פרס לזוכה בשקלים", 0, 10000],
      ] as [keyof Settings, string, number, number][]).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={state.settings[key]} onChange={(event) => updateSetting(key, clampInteger(Number(event.target.value), min, max))} /></label>)}</div><button className="primary start-experiment" onClick={beginPractice}>אישור ההגדרות ומעבר לאימון</button></article>
      <article className="panel"><p className="panel-label">פרטי הרצה ושמירה</p><h2>גיבוי ויצוא</h2><label className="stacked-label">קוד הרצה<input value={state.sessionCode} onChange={(event) => setState((current) => ({ ...current, sessionCode: event.target.value }))} /></label><p className="field-help">הקוד נוצר אוטומטית משם הניסוי ומתאריך ההרצה.</p><div className="backup-card"><strong>גיבוי חי</strong><p>כל שינוי נשמר במחשב ומגובה מיד במאגר מקוון כאשר יש אינטרנט. כך ניתן לשחזר הרצה גם ממחשב אחר באמצעות קוד ההרצה.</p><button className="secondary" onClick={restoreFromLiveBackup}>שחזור לפי קוד ההרצה</button>{restoreMessage && <span>{restoreMessage}</span>}</div><label className="stacked-label">הערות וחריגים<textarea rows={5} value={state.notes} onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))} /></label><div className="drive-card"><strong>Google Drive</strong><p>בסיום התחרות יורד קובץ Excel מלא. ניתן לפתוח מכאן את תיקיית המחקר ולהעלות אליו את הקובץ.</p><a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">פתיחת תיקיית Pothos ב-Drive</a></div><div className="button-stack"><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel עכשיו</button><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></div></article>
    </section>}
  </main>;
}
