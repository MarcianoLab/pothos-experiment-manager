"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  chooseDriveFolder,
  ensureFolderPermission,
  getStoredDriveFolder,
  syncWorkbookToFolder,
  type WritableDirectoryHandle,
} from "../lib/driveFolderSync";
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

function speakHebrew(text: string, cancelPrevious = false) {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    if (cancelPrevious) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "he-IL";
    utterance.rate = 1.08;
    utterance.volume = 1;
    const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("he"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function playBeep(frequency = 880, duration = 120) {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(.22, context.currentTime + .01);
  gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration / 1000);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration / 1000 + .02);
  oscillator.onended = () => void context.close();
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
        timer: { ...current.timer, phase: resumedPhase, endAt: resumedPhase === "running" ? Date.now() + remaining * 1000 : null },
      };
    }
    return {
      ...current,
      timer: {
        phase: "countdown",
        countdownLeft: current.settings.countdownSeconds,
        secondsLeft: current.settings.durationSeconds,
        endAt: null,
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

  return <div className="timer-control-body">
    <div className="timer-readout">
      <div className={`timer-preview ${timer.secondsLeft <= 5 && timer.phase === "running" ? "urgent" : ""}`}>{timerText}</div>
      <p className="timer-caption">{caption}</p>
    </div>
    <div className="button-row">
      <button className="primary" onClick={start} disabled={active}>
        {timer.phase === "paused" ? "המשך זמן הזריקה" : "התחלת זמן הזריקה"}
      </button>
      <button className="danger" onClick={pause} disabled={!active}>עצירת השעון</button>
      <button className="ghost-on-dark" onClick={reset}>איפוס</button>
    </div>
  </div>;
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

function TurnNavigator({ state, practice, onSelect, onPrevious, onNext }: {
  state: ExperimentState;
  practice: boolean;
  onSelect: (round: number, participant: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const roundCount = practice ? state.settings.practiceRounds : state.settings.competitionRounds;
  const scores = practice ? state.practiceScores : state.competitionScores;
  const currentIndex = (state.currentRound - 1) * state.settings.participantCount + state.currentParticipant;
  const totalTurns = roundCount * state.settings.participantCount;
  return <section className="turn-navigator panel">
    <div className="turn-nav-heading"><div><p className="panel-label">{practice ? "עמדות לתיעוד" : "סרגל תורים"}</p><h3>סבב {state.currentRound} · משתתף {state.currentParticipant}</h3></div><span>{currentIndex} מתוך {totalTurns}</span></div>
    <div className="round-tabs" aria-label="בחירת סבב">{Array.from({ length: roundCount }, (_, index) => <button key={index} className={state.currentRound === index + 1 ? "active" : ""} onClick={() => onSelect(index + 1, state.currentParticipant)}>סבב {index + 1}</button>)}</div>
    <div className="participant-queue" aria-label="בחירת משתתף">{Array.from({ length: state.settings.participantCount }, (_, index) => {
      const participant = index + 1;
      const completed = Object.prototype.hasOwnProperty.call(scores, scoreKey(state.currentRound, participant));
      return <button key={participant} className={`${state.currentParticipant === participant ? "active" : ""} ${completed ? "completed" : ""}`} onClick={() => onSelect(state.currentRound, participant)}><span>{participant}</span><small>{completed ? "תועד" : "ממתין"}</small></button>;
    })}</div>
    <div className="turn-nav-actions"><button className="secondary" onClick={onPrevious} disabled={currentIndex <= 1}>התור הקודם</button><button className="primary" onClick={onNext}>{currentIndex >= totalTurns ? (practice ? "מעבר לתחרות" : "סיום התחרות") : "התור הבא"}</button></div>
  </section>;
}

export default function OperatorApp() {
  const { state, setState, replaceState, hydrated, saveStatus } = useExperiment();
  const [tab, setTab] = useState<Tab>("settings");
  const [practiceRound, setPracticeRound] = useState(1);
  const [practiceParticipant, setPracticeParticipant] = useState(1);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [driveFolder, setDriveFolder] = useState<WritableDirectoryHandle | null>(null);
  const [driveStatus, setDriveStatus] = useState("טרם נשמר קובץ ל-Drive");
  const lastAnnouncement = useRef("");
  const countdownRun = useRef(0);

  useEffect(() => {
    if (state.timer.phase !== "running") return;
    const tick = () => setState((current) => {
      if (!current.timer.endAt) return current;
      const remaining = Math.max(0, Math.ceil((current.timer.endAt - Date.now()) / 1000));
      if (remaining === current.timer.secondsLeft) return current;
      if (remaining > 0) return { ...current, timer: { ...current.timer, secondsLeft: remaining } };
      return { ...current, timer: { ...current.timer, phase: "finished", secondsLeft: 0, endAt: null, pausedPhase: undefined } };
    });
    tick();
    const interval = window.setInterval(tick, 120);
    return () => window.clearInterval(interval);
  }, [state.timer.phase, setState]);

  useEffect(() => {
    if (state.timer.phase !== "countdown") return;
    const run = ++countdownRun.current;
    let cancelled = false;
    window.speechSynthesis?.cancel();

    const startSynchronizedCountdown = async () => {
      const firstNumber = state.timer.countdownLeft || state.settings.countdownSeconds;
      for (let number = firstNumber; number >= 1; number -= 1) {
        if (cancelled || run !== countdownRun.current) return;
        setState((current) => current.timer.phase === "countdown"
          ? { ...current, timer: { ...current.timer, countdownLeft: number } }
          : current);
        await Promise.all([
          speakHebrew(hebrewNumbers[number] ?? String(number), number === firstNumber),
          wait(1000),
        ]);
      }
      if (cancelled || run !== countdownRun.current) return;
      await speakHebrew("התחילו");
      if (cancelled || run !== countdownRun.current) return;
      setState((current) => current.timer.phase === "countdown" ? {
        ...current,
        timer: {
          phase: "running",
          countdownLeft: 0,
          secondsLeft: current.settings.durationSeconds,
          endAt: Date.now() + current.settings.durationSeconds * 1000,
          pausedPhase: undefined,
        },
      } : current);
    };

    void startSynchronizedCountdown();
    return () => {
      cancelled = true;
      window.speechSynthesis?.cancel();
    };
  }, [state.timer.phase, setState]);

  useEffect(() => {
    const { timer } = state;
    const key = `${timer.phase}-${timer.phase === "countdown" ? timer.countdownLeft : timer.secondsLeft}`;
    if (lastAnnouncement.current === key) return;
    lastAnnouncement.current = key;
    if (timer.phase === "running" && timer.secondsLeft <= 3 && timer.secondsLeft > 0) playBeep(760 + (3 - timer.secondsLeft) * 130, 150);
    if (timer.phase === "finished") {
      playBeep(520, 260);
      speakHebrew("הזמן הסתיים");
    }
  }, [state.timer, state.settings.durationSeconds, state.settings.countdownSeconds]);

  useEffect(() => {
    getStoredDriveFolder().then(async (handle) => {
      if (!handle) return;
      if (await ensureFolderPermission(handle)) {
        setDriveFolder(handle);
        setDriveStatus(`מחובר לתיקייה: ${handle.name}`);
      } else {
        setDriveStatus(`נמצאה התיקייה ${handle.name} · יש לאשר מחדש גישה`);
      }
    }).catch(() => undefined);
  }, []);

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
    return { ...current, stage: "finished" as const, timer: freshTimer(current) };
  });

  const nextCompetitionTurn = () => setState((current) => {
    if (current.currentParticipant === current.settings.participantCount && current.currentRound === current.settings.competitionRounds) {
      return { ...current, stage: "finished" as const, timer: freshTimer(current) };
    }
    let participant = current.currentParticipant + 1;
    let round = current.currentRound;
    if (participant > current.settings.participantCount) {
      participant = 1;
      round += 1;
    }
    return { ...current, currentParticipant: participant, currentRound: round, timer: freshTimer(current) };
  });

  const nextPracticeTurn = () => setState((current) => {
    if (current.currentParticipant === current.settings.participantCount && current.currentRound === current.settings.practiceRounds) {
      return { ...current, stage: "competition", currentRound: 1, currentParticipant: 1, timer: freshTimer(current) };
    }
    let participant = current.currentParticipant + 1;
    let round = current.currentRound;
    if (participant > current.settings.participantCount) {
      participant = 1;
      round += 1;
    }
    return { ...current, currentParticipant: participant, currentRound: round, timer: participant === 1 ? freshTimer(current) : current.timer };
  });

  const previousTurn = () => setState((current) => {
    let participant = current.currentParticipant - 1;
    let round = current.currentRound;
    if (participant < 1 && round > 1) {
      participant = current.settings.participantCount;
      round -= 1;
    }
    if (participant < 1) participant = 1;
    return { ...current, currentParticipant: participant, currentRound: round, timer: current.stage === "practice" ? current.timer : freshTimer(current) };
  });

  const selectTurn = (round: number, participant: number) => setState((current) => ({
    ...current,
    currentRound: round,
    currentParticipant: participant,
    timer: current.stage === "practice" ? current.timer : freshTimer(current),
  }));

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

  const connectDriveFolder = async () => {
    try {
      const handle = driveFolder && await ensureFolderPermission(driveFolder, true)
        ? driveFolder
        : await chooseDriveFolder();
      setDriveFolder(handle);
      setDriveStatus(`שומר בתיקייה: ${handle.name}…`);
      await syncWorkbookToFolder(state, handle);
      setDriveStatus(`Excel נשמר ב-Drive: ${handle.name}`);
    } catch (error) {
      if (error instanceof Error && error.message === "unsupported") {
        await exportWorkbook(state);
        window.open(DRIVE_FOLDER_URL, "_blank", "noopener,noreferrer");
        setDriveStatus("הקובץ הורד והתיקייה נפתחה · יש להעלות אותו אליה.");
      } else {
        setDriveStatus("השמירה בוטלה או שהגישה לתיקייה לא אושרה.");
      }
    }
  };

  if (!hydrated) return <main className="loading-screen">טוען את נתוני ההרצה…</main>;

  const saveLabels = {
    local: "נשמר במחשב",
    syncing: "מעדכן גיבוי חי…",
    cloud: "גיבוי חי מעודכן",
    offline: "אין אינטרנט · נשמר במחשב",
  };

  return <main className={`operator-shell ${tab === "run" ? "operator-shell-run" : ""}`} dir="rtl">
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

    {tab === "run" && <div className="run-tab-content">
      <section className="stage-strip three-stages">
        {(["practice", "competition", "finished"] as Stage[]).map((stage) => <button key={stage} className={state.stage === stage ? "active" : ""} onClick={() => stage === "finished" ? finishCompetition() : changeStage(stage)}>{stageLabels[stage]}</button>)}
      </section>

      {state.stage !== "finished" ? <>
        {state.stage === "setup" ? <section className="panel callout"><h2>יש לאשר תחילה את הגדרות ההרצה</h2><button className="primary" onClick={() => setTab("settings")}>מעבר להגדרות</button></section> : <section className="run-workspace">
            <article className="hero-card compact-hero operator-timer">
              <div className="timer-context">
              <span className="pill">{stageLabels[state.stage]}</span>
              <h2>{state.stage === "practice" ? `סבב אימון ${state.currentRound} · תיעוד עמדה ${state.currentParticipant}` : `סבב ${state.currentRound} · משתתף ${state.currentParticipant}`}</h2>
              </div>
              <TimerControls state={state} setState={setState} />
            </article>
            <TurnNavigator
              state={state}
              practice={state.stage === "practice"}
              onSelect={selectTurn}
              onPrevious={previousTurn}
              onNext={state.stage === "practice" ? nextPracticeTurn : nextCompetitionTurn}
            />
          <section className="panel score-panel"><ScoreEditor state={state} setState={setState} practice={state.stage === "practice"} round={state.currentRound} participant={state.currentParticipant} onComplete={state.stage === "practice" ? nextPracticeTurn : nextCompetitionTurn} /></section>
        </section>}
      </> : <>
        <section className="hero-card finished-hero"><span className="pill">התחרות הסתיימה</span><div className="winner-block"><p>{winners(state).length > 1 ? "הזוכים בתחרות" : "הזוכה בתחרות"}</p><strong>{winners(state).map((row) => `#${row.participant}`).join(", ")}</strong><span>{winners(state)[0]?.score ?? 0} נקודות</span></div></section>
        <section className="panel finish-actions"><button className="primary" onClick={connectDriveFolder}>שמירת Excel ל-Drive</button><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel למחשב</button><a className="secondary button-link" href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">פתיחת התיקייה בענן</a><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button><p className="drive-finish-status">{driveStatus}</p></section>
      </>}
    </div>}

    {tab === "scores" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">תוצאות התחרות</p><h2>טבלה מצטברת</h2></div><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel מלא</button></div><Leaderboard state={state} chooseScore={(participant, round) => { setState((current) => ({ ...current, currentParticipant: participant, currentRound: round, stage: "competition", timer: freshTimer(current) })); setTab("run"); }} /></section>}

    {tab === "practice" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">אינו מוקרן למשתתפים</p><h2>תיעוד אימון בזמן אמת או בדיעבד</h2></div><div className="selector-row"><label>סבב<select value={practiceRound} onChange={(event) => setPracticeRound(Number(event.target.value))}>{Array.from({ length: state.settings.practiceRounds }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label><label>משתתף<select value={practiceParticipant} onChange={(event) => setPracticeParticipant(Number(event.target.value))}>{Array.from({ length: state.settings.participantCount }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label></div></div><ScoreEditor state={state} setState={setState} practice round={practiceRound} participant={practiceParticipant} onComplete={nextPrivatePractice} /></section>}

    {tab === "settings" && <section className="settings-grid">
      <article className="panel"><p className="panel-label">בדיקה לפני ההתחלה</p><h2>מבנה הניסוי</h2><div className="form-grid">{([
        ["participantCount", "מספר משתתפים", 1, 30], ["dartCount", "חצים בסבב", 1, 20], ["practiceRounds", "סבבי אימון", 0, 20], ["competitionRounds", "סבבי תחרות", 1, 20],
        ["durationSeconds", "זמן זריקה בשניות", 3, 120], ["countdownSeconds", "ספירה לאחור", 0, 10], ["maxScore", "ניקוד מרבי לחץ", 1, 100], ["prizeAmount", "פרס לזוכה בשקלים", 0, 10000],
      ] as [keyof Settings, string, number, number][]).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={state.settings[key]} onChange={(event) => updateSetting(key, clampInteger(Number(event.target.value), min, max))} /></label>)}</div><button className="primary start-experiment" onClick={beginPractice}>אישור ההגדרות ומעבר לאימון</button></article>
      <article className="panel"><p className="panel-label">פרטי הרצה ושמירה</p><h2>גיבוי ויצוא</h2><label className="stacked-label">קוד הרצה<input value={state.sessionCode} onChange={(event) => setState((current) => ({ ...current, sessionCode: event.target.value }))} /></label><p className="field-help">הקוד נוצר אוטומטית משם הניסוי ומתאריך ההרצה.</p><div className="backup-card"><strong>גיבוי חי</strong><p>כל שינוי נשמר במחשב ומגובה מיד במאגר מקוון כאשר יש אינטרנט. כך ניתן לשחזר הרצה גם ממחשב אחר באמצעות קוד ההרצה.</p><button className="secondary" onClick={restoreFromLiveBackup}>שחזור לפי קוד ההרצה</button>{restoreMessage && <span>{restoreMessage}</span>}</div><label className="stacked-label">הערות וחריגים<textarea rows={5} value={state.notes} onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))} /></label><div className="drive-card"><strong>שמירת Excel לתיקיית pothos_data</strong><p>לחצו לשמירה יזומה. בפעם הראשונה בחרו במחשב את תיקיית pothos_data שבתוך Google Drive. לאחר מכן הכפתור יעדכן בה את קובץ ההרצה.</p><button className="primary" onClick={connectDriveFolder}>שמירת Excel ל-Drive</button><span className="drive-status">{driveStatus}</span><a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer">פתיחת pothos_data בענן</a></div><div className="button-stack"><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel למחשב</button><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></div></article>
    </section>}
  </main>;
}
