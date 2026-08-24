"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExperimentState, Settings, Stage } from "../lib/experiment";
import {
  clampInteger, createExperiment, cumulativeTotal, roundTotal, scoreKey,
  throwsFor, total, winners,
} from "../lib/experiment";
import { useExperiment } from "../lib/useExperiment";

type Tab = "run" | "scores" | "practice" | "settings";
const stageLabels: Record<Stage, string> = { setup: "היערכות", practice: "אימון", competition: "תחרות סדרתית", finished: "הסתיים" };

function freshTimer(current: ExperimentState) {
  return { phase: "idle" as const, secondsLeft: current.settings.durationSeconds, countdownLeft: current.settings.countdownSeconds, endAt: null };
}

function TimerControls({ state, setState }: { state: ExperimentState; setState: React.Dispatch<React.SetStateAction<ExperimentState>> }) {
  const { timer, settings } = state;
  const start = () => setState((current) => ({ ...current, timer: { phase: "countdown", countdownLeft: current.settings.countdownSeconds, secondsLeft: current.settings.durationSeconds, endAt: Date.now() + current.settings.countdownSeconds * 1000 } }));
  const stop = () => setState((current) => ({ ...current, timer: { ...current.timer, phase: "finished", secondsLeft: 0, endAt: null } }));
  const reset = () => setState((current) => ({ ...current, timer: freshTimer(current) }));
  return <>
    <div className={`timer-preview ${timer.secondsLeft <= 5 && timer.phase === "running" ? "urgent" : ""}`}>{timer.phase === "countdown" ? timer.countdownLeft : timer.secondsLeft}</div>
    <p className="timer-caption">{timer.phase === "countdown" ? "מתחילים בעוד…" : timer.phase === "running" ? "זמן זריקה" : timer.phase === "finished" ? "הזמן הסתיים" : "מוכן להפעלה"}</p>
    <div className="button-row">
      <button className="primary" onClick={start} disabled={timer.phase === "running" || timer.phase === "countdown"}>התחלת {settings.countdownSeconds}–2–1</button>
      <button className="danger" onClick={stop}>עצירת בטיחות</button>
      <button className="ghost-on-dark" onClick={reset}>איפוס שעון</button>
    </div>
  </>;
}

function ScoreEditor({ state, setState, practice = false, round, participant }: { state: ExperimentState; setState: React.Dispatch<React.SetStateAction<ExperimentState>>; practice?: boolean; round: number; participant: number }) {
  const source = practice ? state.practiceScores : state.competitionScores;
  const values = throwsFor(source, round, participant, state.settings.dartCount);
  const updateThrow = (index: number, raw: number) => {
    const value = clampInteger(raw, 0, state.settings.maxScore);
    setState((current) => {
      const scores = practice ? current.practiceScores : current.competitionScores;
      const next = throwsFor(scores, round, participant, current.settings.dartCount);
      next[index] = value;
      return practice ? { ...current, practiceScores: { ...scores, [scoreKey(round, participant)]: next } } : { ...current, competitionScores: { ...scores, [scoreKey(round, participant)]: next } };
    });
  };
  return <div>
    <div className="panel-heading"><div><p className="panel-label">{practice ? "תוצאות אימון פרטיות" : "הזנת תוצאה"}</p><h2>סבב {round} · משתתף {participant}</h2></div><strong className="score-total">סה״כ {total(values)}</strong></div>
    <div className="dart-grid">{values.map((value, index) => <label key={index}>חץ {index + 1}<input aria-label={`חץ ${index + 1}`} type="number" inputMode="numeric" min={0} max={state.settings.maxScore} value={value} onChange={(event) => updateThrow(index, Number(event.target.value))} onFocus={(event) => event.currentTarget.select()} /></label>)}</div>
    {practice && <p className="privacy-note">הנתונים באזור זה נשמרים, אך לעולם אינם מופיעים במסך המשתתפים.</p>}
  </div>;
}

function Leaderboard({ state, editable = false, setState }: { state: ExperimentState; editable?: boolean; setState?: React.Dispatch<React.SetStateAction<ExperimentState>> }) {
  return <div className="table-wrap"><table><thead><tr><th>משתתף</th>{Array.from({ length: state.settings.competitionRounds }, (_, i) => <th key={i}>סבב {i + 1}</th>)}<th>מצטבר</th></tr></thead><tbody>
    {Array.from({ length: state.settings.participantCount }, (_, pIndex) => { const participant = pIndex + 1; return <tr key={participant}><th>#{participant}</th>{Array.from({ length: state.settings.competitionRounds }, (_, rIndex) => { const round = rIndex + 1; return <td key={round}>{editable && setState ? <button className="cell-button" onClick={() => setState((current) => ({ ...current, currentParticipant: participant, currentRound: round }))}>{roundTotal(state, participant, round)}</button> : roundTotal(state, participant, round)}</td>; })}<td className="cumulative">{cumulativeTotal(state, participant)}</td></tr>; })}
  </tbody></table></div>;
}

async function exportWorkbook(state: ExperimentState) {
  const XLSX = await import("xlsx");
  const competition: Record<string, string | number>[] = [];
  const practice: Record<string, string | number>[] = [];
  for (let participant = 1; participant <= state.settings.participantCount; participant += 1) {
    for (let round = 1; round <= state.settings.competitionRounds; round += 1) {
      const hits = throwsFor(state.competitionScores, round, participant, state.settings.dartCount);
      const row: Record<string, string | number> = { session: state.sessionCode, participant, round, total: total(hits) };
      hits.forEach((hit, index) => { row[`dart_${index + 1}`] = hit; }); competition.push(row);
    }
    for (let round = 1; round <= state.settings.practiceRounds; round += 1) {
      const hits = throwsFor(state.practiceScores, round, participant, state.settings.dartCount);
      const row: Record<string, string | number> = { session: state.sessionCode, participant, round, total: total(hits) };
      hits.forEach((hit, index) => { row[`dart_${index + 1}`] = hit; }); practice.push(row);
    }
  }
  const summary = Array.from({ length: state.settings.participantCount }, (_, index) => ({ session: state.sessionCode, participant: index + 1, competition_total: cumulativeTotal(state, index + 1) }));
  const metadata = [
    { field: "session_code", value: state.sessionCode }, { field: "experiment_id", value: state.id }, { field: "created_at", value: state.createdAt }, { field: "updated_at", value: state.updatedAt },
    { field: "participants", value: state.settings.participantCount }, { field: "darts_per_round", value: state.settings.dartCount }, { field: "practice_rounds", value: state.settings.practiceRounds },
    { field: "competition_rounds", value: state.settings.competitionRounds }, { field: "duration_seconds", value: state.settings.durationSeconds }, { field: "notes", value: state.notes },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(competition), "Competition");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(practice), "Practice_private");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadata), "Metadata");
  XLSX.writeFile(workbook, `${state.sessionCode}.xlsx`);
}

export default function OperatorApp() {
  const { state, setState, replaceState, hydrated, saveStatus } = useExperiment();
  const [tab, setTab] = useState<Tab>("run");
  const [practiceRound, setPracticeRound] = useState(1);
  const [practiceParticipant, setPracticeParticipant] = useState(1);

  useEffect(() => {
    if (state.timer.phase !== "countdown" && state.timer.phase !== "running") return;
    const tick = () => setState((current) => {
      if (!current.timer.endAt) return current;
      const remaining = Math.max(0, Math.ceil((current.timer.endAt - Date.now()) / 1000));
      if (current.timer.phase === "countdown") {
        if (remaining > 0 && remaining === current.timer.countdownLeft) return current;
        if (remaining > 0) return { ...current, timer: { ...current.timer, countdownLeft: remaining } };
        return { ...current, timer: { phase: "running", countdownLeft: 0, secondsLeft: current.settings.durationSeconds, endAt: Date.now() + current.settings.durationSeconds * 1000 } };
      }
      if (remaining === current.timer.secondsLeft) return current;
      if (remaining > 0) return { ...current, timer: { ...current.timer, secondsLeft: remaining } };
      return { ...current, timer: { ...current.timer, phase: "finished", secondsLeft: 0, endAt: null } };
    });
    tick(); const interval = window.setInterval(tick, 120); return () => window.clearInterval(interval);
  }, [state.timer.phase, setState]);

  const currentValues = useMemo(() => throwsFor(state.competitionScores, state.currentRound, state.currentParticipant, state.settings.dartCount), [state]);
  const nextTurn = () => setState((current) => { let participant = current.currentParticipant + 1; let round = current.currentRound; if (participant > current.settings.participantCount) { participant = 1; round = Math.min(current.settings.competitionRounds, round + 1); } return { ...current, currentParticipant: participant, currentRound: round, timer: freshTimer(current) }; });
  const setStage = (stage: Stage) => setState((current) => ({ ...current, stage, currentParticipant: 1, currentRound: 1, timer: freshTimer(current) }));
  const updateSetting = (key: keyof Settings, value: number) => setState((current) => { const settings = { ...current.settings, [key]: value }; return { ...current, settings, timer: { ...current.timer, secondsLeft: settings.durationSeconds, countdownLeft: settings.countdownSeconds } }; });
  const newSession = () => { if (!window.confirm("לפתוח הרצה חדשה? מומלץ להוריד קודם את קובץ ה-Excel של ההרצה הנוכחית.")) return; replaceState(createExperiment()); setTab("run"); };
  if (!hydrated) return <main className="loading-screen">טוען את נתוני ההרצה…</main>;
  const saveLabels = { local: "נשמר מקומית", syncing: "מסנכרן לענן…", cloud: "נשמר מקומית ובענן", offline: "אין חיבור · נשמר מקומית" };

  return <main className="operator-shell" dir="rtl">
    <header className="topbar"><div><p className="eyebrow">מערכת ניהול ניסוי · {state.sessionCode}</p><h1>פוטוס · תחרות הדיוק</h1></div><div className="top-actions"><span className={`sync-badge ${saveStatus}`}><i />{saveLabels[saveStatus]}</span><button className="secondary" onClick={() => window.open("/display", "photos-display", "popup=yes")}>פתיחת מסך המשתתפים</button></div></header>
    <nav className="tabs" aria-label="אזורים במערכת"><button className={tab === "run" ? "active" : ""} onClick={() => setTab("run")}>ניהול התחרות</button><button className={tab === "scores" ? "active" : ""} onClick={() => setTab("scores")}>טבלת תוצאות</button><button className={tab === "practice" ? "active" : ""} onClick={() => setTab("practice")}>אימון פרטי</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>הגדרות ויצוא</button></nav>

    {tab === "run" && <>
      <section className="stage-strip">{(["setup", "practice", "competition", "finished"] as Stage[]).map((stage) => <button key={stage} className={state.stage === stage ? "active" : ""} onClick={() => setStage(stage)}>{stageLabels[stage]}</button>)}</section>
      <section className="status-grid">
        <article className="hero-card"><span className="pill">{stageLabels[state.stage]}</span><h2>{state.stage === "practice" ? `סבב אימון ${state.currentRound}` : state.stage === "competition" ? `סבב ${state.currentRound} · משתתף ${state.currentParticipant}` : state.stage === "finished" ? "התחרות הסתיימה" : "מוכנים להתחלה"}</h2>{state.stage !== "finished" ? <TimerControls state={state} setState={setState} /> : <div className="winner-block"><p>הזוכים בתחרות</p><strong>{winners(state).map((row) => `#${row.participant}`).join(", ")}</strong><span>{winners(state)[0]?.score ?? 0} נקודות</span></div>}</article>
        <article className="panel compact-panel"><p className="panel-label">בקרת הרצה</p><label className="inline-select">סבב<select value={state.currentRound} onChange={(event) => setState((current) => ({ ...current, currentRound: Number(event.target.value), timer: freshTimer(current) }))}>{Array.from({ length: state.stage === "practice" ? state.settings.practiceRounds : state.settings.competitionRounds }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>{state.stage !== "practice" && <label className="inline-select">משתתף<select value={state.currentParticipant} onChange={(event) => setState((current) => ({ ...current, currentParticipant: Number(event.target.value), timer: freshTimer(current) }))}>{Array.from({ length: state.settings.participantCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}{state.stage === "competition" && <><div className="current-score"><span>הניקוד בתור</span><strong>{total(currentValues)}</strong></div><button className="secondary wide" onClick={nextTurn}>שמירה ומעבר לתור הבא</button></>}{state.stage === "practice" && <button className="secondary wide" onClick={() => setState((current) => ({ ...current, currentRound: Math.min(current.settings.practiceRounds, current.currentRound + 1), timer: freshTimer(current) }))}>מעבר לסבב האימון הבא</button>}</article>
      </section>
      {state.stage === "competition" && <section className="panel"><ScoreEditor state={state} setState={setState} round={state.currentRound} participant={state.currentParticipant} /></section>}
      {state.stage === "setup" && <section className="panel callout"><h2>לפני שמתחילים</h2><p>פתחו את מסך המשתתפים, העבירו אותו למקרן ובדקו שמספר ההרצה והגדרות הקבוצה נכונים.</p><button className="primary" onClick={() => setStage("practice")}>מעבר לשלב האימון</button></section>}
      {state.stage === "finished" && <section className="panel finish-actions"><button className="primary" onClick={() => exportWorkbook(state)}>הורדת קובץ Excel</button><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></section>}
    </>}

    {tab === "scores" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">תוצאות התחרות</p><h2>טבלה מצטברת</h2></div><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel</button></div><Leaderboard state={state} editable setState={setState} /><p className="privacy-note">לחיצה על ציון בוחרת את אותו משתתף וסבב לצורך תיקון באזור הניהול.</p></section>}

    {tab === "practice" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">אינו מוקרן למשתתפים</p><h2>תיעוד אימון בזמן אמת או בדיעבד</h2></div><div className="selector-row"><label>סבב<select value={practiceRound} onChange={(e) => setPracticeRound(Number(e.target.value))}>{Array.from({ length: state.settings.practiceRounds }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label><label>משתתף<select value={practiceParticipant} onChange={(e) => setPracticeParticipant(Number(e.target.value))}>{Array.from({ length: state.settings.participantCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label></div></div><ScoreEditor state={state} setState={setState} practice round={practiceRound} participant={practiceParticipant} /></section>}

    {tab === "settings" && <section className="settings-grid"><article className="panel"><p className="panel-label">מבנה הניסוי</p><h2>הגדרות גמישות</h2><div className="form-grid">{([ ["participantCount", "מספר משתתפים", 1, 30], ["dartCount", "חצים בסבב", 1, 20], ["practiceRounds", "סבבי אימון", 0, 20], ["competitionRounds", "סבבי תחרות", 1, 20], ["durationSeconds", "זמן זריקה בשניות", 3, 120], ["countdownSeconds", "ספירה לאחור", 0, 10], ["maxScore", "ניקוד מרבי לחץ", 1, 100], ["prizeAmount", "פרס לזוכה בשקלים", 0, 10000] ] as [keyof Settings, string, number, number][]).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={state.settings[key]} onChange={(e) => updateSetting(key, clampInteger(Number(e.target.value), min, max))} /></label>)}</div></article><article className="panel"><p className="panel-label">פרטי הרצה וגיבוי</p><h2>שמירה ויצוא</h2><label className="stacked-label">קוד הרצה<input value={state.sessionCode} onChange={(e) => setState((current) => ({ ...current, sessionCode: e.target.value }))} /></label><label className="stacked-label">הערות וחריגים<textarea rows={6} value={state.notes} onChange={(e) => setState((current) => ({ ...current, notes: e.target.value }))} /></label><div className="button-stack"><button className="primary" onClick={() => exportWorkbook(state)}>הורדת Excel עכשיו</button><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></div></article></section>}
  </main>;
}
