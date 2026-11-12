"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExperimentState, Settings, Stage } from "../lib/experiment";
import {
  clampInteger,
  createExperiment,
  cumulativeTotal,
  awardCompetitionPrize,
  finishCompetition as markCompetitionFinished,
  drawPracticePositions,
  practicePositionFor,
  practiceHeatFor,
  practiceHeatsFor,
  practiceTurnFor,
  practicePositionsFor,
  prizeDrawNeedsUpdate,
  normalizeState,
  roundTotal,
  scoreKey,
  STORAGE_KEY,
  throwsFor,
  total,
  winners,
} from "../lib/experiment";
import { exportWorkbook } from "../lib/exportWorkbook";
import {
  chooseFolder,
  chooseNetworkFolder,
  ensureFolderPermission,
  getStoredFolder,
  getStoredNetworkFolder,
  type NetworkFolderConnection,
  syncWorkbookToFolder,
  type WritableDirectoryHandle,
} from "../lib/driveFolderSync";
import { useExperiment } from "../lib/useExperiment";

type Tab = "run" | "scores" | "practice" | "settings";

const NETWORK_DATA_PATH = "\\\\vscifs.huji.ac.il\\lab_marciano\\Experiments\\Serial Performances\\Mechanism Lab Experiments - Brains competition\\pothos_experiment_01\\data";
const NETWORK_PATH_STORAGE_KEY = "pothos-network-path";
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

let sharedAudioContext: AudioContext | null = null;

function getAudioContext() {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) sharedAudioContext = new AudioContextClass();
  return sharedAudioContext;
}

function prepareAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") void context.resume();
}

function scheduleTone(context: AudioContext, startAt: number, frequency: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.001, startAt);
  gain.gain.exponentialRampToValueAtTime(.22, startAt + .01);
  gain.gain.exponentialRampToValueAtTime(.001, startAt + duration / 1000);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration / 1000 + .02);
  return oscillator;
}

function playBeep(frequency = 880, duration = 120) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") void context.resume();
  scheduleTone(context, context.currentTime + .01, frequency, duration);
}

function scheduleFinalBeeps(endAt: number) {
  const context = getAudioContext();
  if (!context) return () => undefined;
  if (context.state === "suspended") void context.resume();
  const sources: OscillatorNode[] = [];
  [3, 2, 1].forEach((second) => {
    const delaySeconds = (endAt - Date.now() - second * 1000) / 1000;
    if (delaySeconds < -.08) return;
    sources.push(scheduleTone(context, context.currentTime + Math.max(.01, delaySeconds), 760 + (3 - second) * 130, 150));
  });
  return () => sources.forEach((source) => {
    try { source.stop(); } catch { /* the tone has already ended */ }
  });
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

  const start = () => {
    prepareAudio();
    setState((current) => {
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
  };

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

function ScoreEditor({ state, setState, practice = false, round, participant, onComplete, onPrevious, onNext, previousDisabled = false, nextLabel = "התור הבא" }: {
  state: ExperimentState;
  setState: React.Dispatch<React.SetStateAction<ExperimentState>>;
  practice?: boolean;
  round: number;
  participant: number;
  onComplete?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextLabel?: string;
}) {
  const source = practice ? state.practiceScores : state.competitionScores;
  const values = throwsFor(source, round, participant, state.settings.dartCount);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

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
    const value = clampInteger(Number(raw), 0, state.settings.maxScore);
    setState((current) => {
      const scores = practice ? current.practiceScores : current.competitionScores;
      const next = throwsFor(scores, round, participant, current.settings.dartCount);
      next[index] = value;
      return practice
        ? { ...current, practiceScores: { ...scores, [scoreKey(round, participant)]: next } }
        : { ...current, competitionScores: { ...scores, [scoreKey(round, participant)]: next } };
    });

  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Enter" && !event.repeat && !event.nativeEvent.isComposing) {
      event.preventDefault();
      moveForward(index);
    }
  };

  return <div>
    <div className="panel-heading score-heading">
      <div>
        <p className="panel-label">{practice ? "תוצאות אימון פרטיות" : "הזנת תוצאה"}</p>
        <h2>סבב {round}{practice ? ` · מקצה ${practiceHeatFor(state, participant)} · עמדה ${practicePositionFor(state, participant)}` : ""} · משתתף {participant}</h2>
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
    <p className="keyboard-hint">הקלידו ציון ולחצו Enter למעבר לחץ הבא. אחרי החץ האחרון, Enter מעביר לתור הבא. אפשר לבחור שדה או תור גם בלחיצה.</p>
    {(onPrevious || onNext) && <div className="score-turn-actions">
      <button className="secondary" onClick={onPrevious} disabled={previousDisabled}>התור הקודם</button>
      <button className="primary" onClick={onNext}>{nextLabel}</button>
    </div>}
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

function TurnNavigator({ state, practice, onSelect }: {
  state: ExperimentState;
  practice: boolean;
  onSelect: (round: number, participant: number) => void;
}) {
  const roundCount = practice ? state.settings.practiceRounds : state.settings.competitionRounds;
  const scores = practice ? state.practiceScores : state.competitionScores;
  const positions = practicePositionsFor(state);
  const heat = practiceHeatFor(state, state.currentParticipant);
  const currentIndex = (state.currentRound - 1) * state.settings.participantCount + (practice ? positions.indexOf(state.currentParticipant) + 1 : state.currentParticipant);
  const totalTurns = roundCount * state.settings.participantCount;
  return <section className="turn-navigator panel">
    <div className="turn-nav-heading"><div><p className="panel-label">{practice ? "עמדות לתיעוד" : "סרגל תורים"}</p><h3>סבב {state.currentRound} · משתתף {state.currentParticipant}</h3></div><span>{currentIndex} מתוך {totalTurns}</span></div>
    <div className="turn-selectors"><div className="round-tabs" aria-label="בחירת סבב">{Array.from({ length: roundCount }, (_, index) => <button key={index} className={state.currentRound === index + 1 ? "active" : ""} onClick={() => onSelect(index + 1, state.currentParticipant)}>סבב {index + 1}</button>)}</div>
    {practice && <div className="heat-tabs" aria-label="בחירת מקצה">{practiceHeatsFor(state).map((participants, index) => <button key={index} className={heat === index + 1 ? "active" : ""} onClick={() => onSelect(state.currentRound, participants[0])}>מקצה {index + 1}</button>)}</div>}</div>
    <div className="participant-queue" aria-label={practice ? "בחירת עמדה" : "בחירת משתתף"}>{(practice ? practiceHeatsFor(state)[heat - 1] : Array.from({ length: state.settings.participantCount }, (_, index) => index + 1)).map((participant, index) => {
      const completed = Object.prototype.hasOwnProperty.call(scores, scoreKey(state.currentRound, participant));
      return <button key={participant} aria-label={practice ? `מקצה ${heat} עמדה ${index + 1} משתתף ${participant}` : undefined} className={`${state.currentParticipant === participant ? "active" : ""} ${completed ? "completed" : ""}`} onClick={() => onSelect(state.currentRound, participant)}><span>{practice ? `עמדה ${index + 1}` : participant}</span><small>{practice ? `משתתף ${participant} · ` : ""}{completed ? "תועד" : "ממתין"}</small></button>;
    })}</div>
  </section>;
}

export default function OperatorApp() {
  const { state, setState, replaceState, hydrated, saveStatus } = useExperiment();
  const finishingRef = useRef(false);
  const [tab, setTab] = useState<Tab>("settings");
  const [practiceRound, setPracticeRound] = useState(1);
  const [practiceParticipant, setPracticeParticipant] = useState(1);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [networkConnection, setNetworkConnection] = useState<NetworkFolderConnection | null>(null);
  const [networkPath, setNetworkPath] = useState(NETWORK_DATA_PATH);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [standalonePicker, setStandalonePicker] = useState(false);
  const networkPathInput = useRef<HTMLInputElement>(null);
  const networkOperation = useRef(false);
  const networkPathChanged = networkConnection !== null && networkConnection.path !== networkPath.trim();
  const networkFolder = networkPathChanged ? null : networkConnection?.handle ?? null;
  const [localFolder, setLocalFolder] = useState<WritableDirectoryHandle | null>(null);
  const [saveToLocal, setSaveToLocal] = useState(true);
  const [networkStatus, setNetworkStatus] = useState("תיקיית הרשת טרם חוברה");
  const [localStatus, setLocalStatus] = useState("טרם נבחרה תיקייה מקומית");
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const lastAnnouncement = useRef("");
  const countdownRun = useRef(0);
  const sessionPromptShown = useRef(false);

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
    if (state.timer.phase !== "running" || !state.timer.endAt) return;
    return scheduleFinalBeeps(state.timer.endAt);
  }, [state.timer.phase, state.timer.endAt]);

  useEffect(() => {
    const { timer } = state;
    const key = `${timer.phase}-${timer.phase === "countdown" ? timer.countdownLeft : timer.secondsLeft}`;
    if (lastAnnouncement.current === key) return;
    lastAnnouncement.current = key;
    if (timer.phase === "finished") {
      playBeep(520, 260);
      speakHebrew("הזמן הסתיים");
    }
  }, [state.timer, state.settings.durationSeconds, state.settings.countdownSeconds]);

  useEffect(() => {
    try {
      setNetworkPath(localStorage.getItem(NETWORK_PATH_STORAGE_KEY) ?? NETWORK_DATA_PATH);
    } catch {
      // The editable path still works for this visit.
    }
    Promise.all([getStoredNetworkFolder(NETWORK_DATA_PATH), getStoredFolder("local-folder")]).then(async ([network, local]) => {
      if (network) {
        setNetworkConnection(network);
        setNetworkStatus(await ensureFolderPermission(network.handle)
          ? `השמירה החיה פעילה: ${network.handle.name}`
          : `נמצאה ${network.handle.name} · יש לאשר מחדש גישה`);
      }
      if (local) {
        setLocalFolder(local);
        setLocalStatus(await ensureFolderPermission(local)
          ? `התיקייה המקומית מוכנה: ${local.name}`
          : `נמצאה ${local.name} · יש לאשר מחדש גישה`);
      }
    }).catch(() => undefined);
  }, []);

  const networkSyncSignature = useMemo(() => JSON.stringify({
    sessionCode: state.sessionCode,
    settings: state.settings,
    competitionScores: state.competitionScores,
    practiceScores: state.practiceScores,
    practicePositions: state.practicePositions,
    notes: state.notes,
    prizeDraw: state.prizeDraw,
    prizeDrawPending: state.prizeDrawPending,
    stage: state.stage,
    currentRound: state.currentRound,
    currentParticipant: state.currentParticipant,
  }), [state]);

  useEffect(() => {
    if (!hydrated || !networkFolder || networkBusy) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (networkOperation.current) return;
      try {
        const permitted = await ensureFolderPermission(networkFolder);
        if (cancelled || networkOperation.current) return;
        if (!permitted) {
          setNetworkStatus("יש לאשר מחדש גישה לתיקיית הרשת");
          return;
        }
        setNetworkStatus("מעדכן את קובץ ה-Excel בתיקיית הרשת…");
        await syncWorkbookToFolder(state, networkFolder);
        if (!cancelled) setNetworkStatus(`השמירה החיה מעודכנת · ${new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
      } catch {
        if (!cancelled) setNetworkStatus("השמירה לרשת נכשלה · ודא חיבור ל-eduroam");
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [hydrated, networkFolder, networkBusy, networkSyncSignature]);

  useEffect(() => {
    if (!hydrated || sessionPromptShown.current) return;
    sessionPromptShown.current = true;
    setShowSessionPrompt(true);
  }, [hydrated]);

  const changeStage = (stage: Stage) => setState((current) => ({
    ...current,
    stage,
    prizeDrawPending: false,
    currentParticipant: stage === "practice" ? practicePositionsFor(current)[0] : 1,
    currentRound: 1,
    timer: freshTimer(current),
  }));

  const beginPractice = () => {
    changeStage(state.settings.practiceRounds > 0 ? "practice" : "competition");
    setTab("run");
  };

  const finishCompetition = () => {
    if (state.prizeDraw) {
      setState((current) => markCompetitionFinished({ ...current, timer: freshTimer(current) }));
      return;
    }
    if (state.stage !== "competition") return;
    let missingTurns = 0;
    for (let round = 1; round <= state.settings.competitionRounds; round += 1) {
      for (let participant = 1; participant <= state.settings.participantCount; participant += 1) {
        if (!Object.hasOwn(state.competitionScores, scoreKey(round, participant))) missingTurns += 1;
      }
    }
    const missing = missingTurns
      ? ` ב-${missingTurns} תורים טרם הוזן ניקוד. תורים אלה ייספרו כאפס נקודות.`
      : "";
    if (!window.confirm(`לסיים את התחרות?${missing}`)) return;
    setState((current) => markCompetitionFinished({ ...current, timer: freshTimer(current) }));
  };

  const drawNeedsUpdate = prizeDrawNeedsUpdate(state);
  const runPrizeDraw = async () => {
    if (finishingRef.current || !(state.prizeDrawPending || drawNeedsUpdate)) return;
    if (drawNeedsUpdate && !window.confirm("להגריל שוב לפי התוצאות המעודכנות? ההגרלה החדשה תחליף את תוצאת ההגרלה הקודמת.")) return;
    finishingRef.current = true;
    try {
      const finalize = () => {
        const saved = localStorage.getItem(STORAGE_KEY);
        const previous = saved ? JSON.parse(saved) as ExperimentState : null;
        const latest = previous?.id === state.id ? previous : state;
        if (latest.prizeDraw?.drawnAt !== state.prizeDraw?.drawnAt) {
          replaceState(latest);
          return;
        }
        const next = awardCompetitionPrize(latest);
        if (next === latest) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        replaceState(next);
      };
      if (navigator.locks) {
        await navigator.locks.request(`pothos-prize-${state.id}`, finalize);
      } else {
        finalize();
      }
    } catch {
      window.alert("לא ניתן לשמור את ההגרלה. יש לוודא שהדפדפן מאפשר שמירה מקומית ולנסות שוב.");
    } finally {
      finishingRef.current = false;
    }
  };

  const nextCompetitionTurn = () => {
    if (state.currentParticipant === state.settings.participantCount && state.currentRound === state.settings.competitionRounds) {
      finishCompetition();
      return;
    }
    setState((current) => {
      if (current.stage !== "competition") return current;
      let participant = current.currentParticipant + 1;
      let round = current.currentRound;
      if (participant > current.settings.participantCount) {
        participant = 1;
        round += 1;
      }
      return { ...current, currentParticipant: participant, currentRound: round, timer: freshTimer(current) };
    });
  };

  const nextPracticeTurn = () => setState((current) => {
    const next = practiceTurnFor(current, 1);
    if (next.finished) {
      return { ...current, stage: "competition", currentRound: 1, currentParticipant: 1, timer: freshTimer(current) };
    }
    return { ...current, currentParticipant: next.participant, currentRound: next.round, timer: next.resetTimer ? freshTimer(current) : current.timer };
  });

  const previousTurn = () => setState((current) => {
    if (current.stage === "practice") {
      const previous = practiceTurnFor(current, -1);
      return { ...current, currentParticipant: previous.participant, currentRound: previous.round, timer: previous.resetTimer ? freshTimer(current) : current.timer };
    }
    let participant = current.currentParticipant - 1;
    let round = current.currentRound;
    if (participant < 1 && round > 1) {
      participant = current.settings.participantCount;
      round -= 1;
    }
    if (participant < 1) participant = 1;
    return { ...current, currentParticipant: participant, currentRound: round, timer: freshTimer(current) };
  });

  const selectTurn = (round: number, participant: number) => setState((current) => ({
    ...current,
    currentRound: round,
    currentParticipant: participant,
    timer: current.stage === "practice" && current.currentRound === round && practiceHeatFor(current, current.currentParticipant) === practiceHeatFor(current, participant) ? current.timer : freshTimer(current),
  }));

  const nextPrivatePractice = () => {
    const next = practiceTurnFor({ ...state, currentRound: practiceRound, currentParticipant: practiceParticipant }, 1);
    if (next.finished) return;
    setPracticeParticipant(next.participant);
    setPracticeRound(next.round);
  };

  const updateSetting = (key: keyof Settings, value: number) => setState((current) => {
    if (current.prizeDraw) return current;
    const settings = { ...current.settings, [key]: value };
    return { ...current, settings, practicePositions: settings.participantCount !== current.settings.participantCount ? drawPracticePositions(settings.participantCount) : current.practicePositions, timer: { ...current.timer, secondsLeft: settings.durationSeconds, countdownLeft: settings.countdownSeconds } };
  });

  const newSession = () => {
    if (!window.confirm("לפתוח הרצה חדשה? מומלץ להוריד קודם את קובץ ה-Excel של ההרצה הנוכחית.")) return;
    replaceState(createExperiment());
    setTab("settings");
  };

  const startNewSessionFromPrompt = () => {
    replaceState(createExperiment());
    setPracticeRound(1);
    setPracticeParticipant(1);
    setTab("settings");
    setShowSessionPrompt(false);
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

  const updateNetworkPath = (value: string) => {
    setNetworkPath(value);
    try {
      localStorage.setItem(NETWORK_PATH_STORAGE_KEY, value);
    } catch {
      setNetworkStatus("לא ניתן לשמור את הנתיב בדפדפן. אפשר להשתמש בו בהרצה הנוכחית.");
    }
  };

  const copyNetworkPath = async () => {
    try {
      await navigator.clipboard.writeText(networkPath.trim());
      setNetworkStatus("הנתיב הועתק. הדביקו אותו בשורת הכתובת של חלון בחירת התיקייה.");
    } catch {
      networkPathInput.current?.focus();
      networkPathInput.current?.select();
      setNetworkStatus("הנתיב סומן. לחצו Ctrl+C כדי להעתיק אותו.");
    }
  };

  const saveToNetwork = async (replaceFolder: boolean) => {
    if (networkOperation.current) return;
    networkOperation.current = true;
    setNetworkBusy(true);
    setStandalonePicker(false);
    try {
      let handle = replaceFolder ? null : networkFolder;
      if (handle) {
        if (!await ensureFolderPermission(handle, true)) throw new Error("permission");
      } else {
        const connection = await chooseNetworkFolder(networkPath.trim());
        setNetworkConnection(connection);
        handle = connection.handle;
      }
      setNetworkStatus(`שומר לתיקיית הרשת דרך ${handle.name}…`);
      await syncWorkbookToFolder(state, handle);
      setNetworkStatus(`Excel מעודכן בתיקיית הרשת · ${handle.name}`);
    } catch (error) {
      if (error instanceof Error && (error.name === "SecurityError" || error.message === "unsupported")) {
        setStandalonePicker(window.self !== window.top);
        setNetworkStatus(window.self !== window.top
          ? "בחירת תיקייה חסומה בתצוגה הזו. פתחו את פוטוס בלשונית דפדפן רגילה ונסו שוב."
          : error.message === "unsupported"
            ? "בחירת תיקייה זמינה ב-Chrome או Edge במחשב."
            : "הדפדפן חסם את חלון הבחירה. נסו ללחוץ שוב על בחירת תיקיית רשת.");
      } else if (error instanceof Error && error.name === "AbortError") {
        setNetworkStatus("לא נבחרה תיקייה. אם הנתיב לא נפתח, בדקו שהוא נגיש בסייר הקבצים ונסו שוב.");
      } else if (error instanceof Error && (error.name === "NotAllowedError" || error.message === "permission")) {
        setNetworkStatus("הגישה לתיקייה לא אושרה. בחרו את התיקייה מחדש ואשרו גישת כתיבה.");
      } else {
        setNetworkStatus("לא ניתן לשמור בתיקייה. בדקו את החיבור ל-eduroam ואת הרשאת הכתיבה.");
      }
    } finally {
      networkOperation.current = false;
      setNetworkBusy(false);
    }
  };

  const saveWorkbookDestinations = async () => {
    if (networkOperation.current) return;
    if (networkPath.trim()) await saveToNetwork(false);
    else setNetworkStatus("הזינו נתיב לתיקיית הרשת בהגדרות.");

    if (saveToLocal) {
      try {
        const handle = localFolder && await ensureFolderPermission(localFolder, true)
          ? localFolder
          : await chooseFolder("local-folder");
        setLocalFolder(handle);
        setLocalStatus(`שומר במחשב דרך ${handle.name}…`);
        await syncWorkbookToFolder(state, handle);
        setLocalStatus(`Excel נשמר במחשב: ${handle.name}`);
      } catch (error) {
        if (error instanceof Error && error.message === "unsupported") {
          await exportWorkbook(state);
          setLocalStatus("Excel הורד לתיקיית ההורדות במחשב");
        } else {
          setLocalStatus("השמירה המקומית בוטלה או לא אושרה");
        }
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
  const activeRoundCount = state.stage === "practice" ? state.settings.practiceRounds : state.settings.competitionRounds;
  const practiceSlot = practicePositionsFor(state).indexOf(state.currentParticipant);
  const activeTurnIndex = (state.currentRound - 1) * state.settings.participantCount + (state.stage === "practice" ? practiceSlot + 1 : state.currentParticipant);
  const isLastActiveTurn = activeTurnIndex >= activeRoundCount * state.settings.participantCount;
  const activeNextLabel = isLastActiveTurn ? (state.stage === "practice" ? "מעבר לתחרות" : "סיום התחרות") : state.stage === "practice" && practicePositionFor(state, state.currentParticipant) === 3 ? (practiceSlot + 1 === state.settings.participantCount ? "לסבב הבא" : "למקצה הבא") : "התור הבא";

  return <main className={`operator-shell ${tab === "run" ? "operator-shell-run" : ""} ${state.stage === "practice" ? "operator-shell-practice" : state.stage === "finished" ? "operator-shell-finished" : ""}`} dir="rtl">
    {showSessionPrompt && <div className="session-choice-backdrop" role="presentation">
      <section className="session-choice" role="dialog" aria-modal="true" aria-labelledby="session-choice-title">
        <p className="panel-label">כניסה למערכת פוטוס</p>
        <h2 id="session-choice-title">האם להתחיל סשן חדש?</h2>
        <p>נמצאו במחשב נתונים מההרצה <strong>{state.sessionCode}</strong>. אפשר לפתוח הרצה חדשה ונקייה או להמשיך את ההרצה הקיימת.</p>
        <div className="network-reminder"><strong>לפני שמתחילים</strong><span>ודא שהמחשב מחובר לרשת ה-Wi-Fi ‏eduroam.</span></div>
        <div className="session-choice-actions">
          <button className="primary" onClick={startNewSessionFromPrompt}>כן, להתחיל סשן חדש</button>
          <button className="secondary" onClick={() => setShowSessionPrompt(false)}>להמשיך את הסשן הקודם</button>
        </div>
      </section>
    </div>}
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
        {(["practice", "competition", "finished"] as Stage[]).map((stage) => <button key={stage} className={state.stage === stage ? "active" : ""} disabled={stage === "finished" && state.stage !== "competition" && !(state.stage === "practice" && state.prizeDraw)} onClick={() => stage === "finished" ? finishCompetition() : changeStage(stage)}>{stageLabels[stage]}</button>)}
      </section>

      {state.stage !== "finished" ? <>
        {state.stage === "practice" && <section className="panel practice-position-panel" aria-label="שיבוץ עמדות לאימון">
          <div className="panel-heading"><div><h2>מקצים ועמדות לאימון</h2><p>3 עמדות בכל מקצה. בתחרות העמדות לפי מספר המשתתף.</p></div><button className="primary" disabled={state.timer.phase === "countdown" || state.timer.phase === "running"} onClick={() => {
            const positions = drawPracticePositions(state.settings.participantCount);
            setState((current) => ({ ...current, practicePositions: positions, currentParticipant: positions[0], timer: freshTimer(current) }));
          }}>הגרלת מקצים ועמדות</button></div>
          <div className="practice-position-list">{practiceHeatsFor(state).map((participants, heatIndex) => <div className="practice-heat-group" key={heatIndex}><b>מקצה {heatIndex + 1}</b><div>{participants.map((participant, stationIndex) => <span key={participant}>עמדה {stationIndex + 1}<strong>משתתף {participant}</strong></span>)}</div></div>)}</div>
        </section>}
        {state.stage === "setup" ? <section className="panel callout"><h2>יש לאשר תחילה את הגדרות ההרצה</h2><button className="primary" onClick={() => setTab("settings")}>מעבר להגדרות</button></section> : <section className="run-workspace">
            <article className="hero-card compact-hero operator-timer">
              <div className="timer-context">
              <span className="pill">{stageLabels[state.stage]}</span>
              <h2>{state.stage === "practice" ? `סבב ${state.currentRound} · מקצה ${practiceHeatFor(state, state.currentParticipant)} · עמדה ${practicePositionFor(state, state.currentParticipant)} · משתתף ${state.currentParticipant}` : `סבב ${state.currentRound} · משתתף ${state.currentParticipant}`}</h2>
              </div>
              <TimerControls state={state} setState={setState} />
            </article>
            <TurnNavigator
              state={state}
              practice={state.stage === "practice"}
              onSelect={selectTurn}
            />
          <section className="panel score-panel"><ScoreEditor state={state} setState={setState} practice={state.stage === "practice"} round={state.currentRound} participant={state.currentParticipant} onComplete={state.stage === "practice" ? nextPracticeTurn : nextCompetitionTurn} onPrevious={previousTurn} onNext={state.stage === "practice" ? nextPracticeTurn : nextCompetitionTurn} previousDisabled={activeTurnIndex <= 1} nextLabel={activeNextLabel} /></section>
        </section>}
      </> : <>
        <div className={`finish-layout${state.prizeDraw ? " finish-layout-with-results" : ""}`}>
          <section className="hero-card finished-hero">
            <span className="pill">התחרות הסתיימה</span>
            {state.prizeDraw ? <div className="winner-block">
              <p>{drawNeedsUpdate ? "הזוכה בהגרלה הקודמת" : "הזוכה בהגרלת הבונוס"}</p>
              <strong>#{state.prizeDraw.winnerParticipant}</strong>
              <span>{state.prizeDraw.prizeAmount} ₪</span>
              {drawNeedsUpdate && <button className="primary" onClick={() => void runPrizeDraw()}>הגרלה חדשה לפי הניקוד המעודכן</button>}
            </div> : state.prizeDrawPending ? <div className="winner-block">
              <button className="primary" onClick={() => void runPrizeDraw()}>הפעלת הגרלת הבונוס</button>
              <span>לחיצה תגריל זוכה אחד לפי הניקוד המצטבר.</span>
            </div> : <div className="winner-block">
              <p>{winners(state).length > 1 ? "הזוכים בתחרות" : "הזוכה בתחרות"}</p>
              <strong>{winners(state).map((row) => `#${row.participant}`).join(", ")}</strong>
              <span>{winners(state)[0]?.score ?? 0} נקודות</span>
            </div>}
          </section>
          {state.prizeDraw && <section className="panel finish-results" aria-labelledby="finish-results-heading">
            <h2 id="finish-results-heading">{drawNeedsUpdate ? "תוצאות ההגרלה לפני תיקון הניקוד" : "תוצאות ההגרלה"}</h2>
            <p>נשלף פתק {state.prizeDraw.winningTicket} מתוך {state.prizeDraw.totalTickets}. {state.prizeDraw.rankingMethod === "shared_rank" ? "משתתפים בתיקו מקבלים אותו מספר פתקים." : "סדר המקומות בתיקו נקבע בהגרלה."}</p>
            <div className="table-wrap"><table aria-labelledby="finish-results-heading">
              <thead><tr><th scope="col">מקום</th><th scope="col">משתתף</th><th scope="col">ניקוד מצטבר</th><th scope="col">פתקים</th></tr></thead>
              <tbody>{state.prizeDraw.ranking.map((row) => <tr key={row.participant}>
                <td>{row.rank}</td><th scope="row">#{row.participant}</th><td>{row.score}</td><td>{row.tickets}</td>
              </tr>)}</tbody>
            </table></div>
          </section>}
          <section className="panel finish-actions" aria-label="פעולות סיום">
            <button className="primary" onClick={saveWorkbookDestinations}>שמירה מיידית לתיקיית הרשת</button>
            <button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel למחשב</button>
            <button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button>
            <p className="drive-finish-status" role="status">{networkPathChanged ? "נתיב הרשת השתנה · יש לבחור תיקייה מחדש" : networkStatus}{saveToLocal ? ` · ${localStatus}` : ""}</p>
          </section>
        </div>
      </>}
    </div>}

    {tab === "scores" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">תוצאות התחרות</p><h2>טבלה מצטברת</h2></div><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel מלא</button></div><Leaderboard state={state} chooseScore={(participant, round) => { setState((current) => ({ ...current, currentParticipant: participant, currentRound: round, stage: "competition", prizeDrawPending: false, timer: freshTimer(current) })); setTab("run"); }} /></section>}

    {tab === "practice" && <section className="panel"><div className="panel-heading"><div><p className="panel-label">אינו מוקרן למשתתפים</p><h2>תיעוד אימון בזמן אמת או בדיעבד</h2></div><div className="selector-row"><label>סבב<select aria-label="סבב לאימון פרטי" value={practiceRound} onChange={(event) => setPracticeRound(Number(event.target.value))}>{Array.from({ length: state.settings.practiceRounds }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label><label>מקצה<select aria-label="מקצה לאימון פרטי" value={practiceHeatFor(state, practiceParticipant)} onChange={(event) => setPracticeParticipant(practiceHeatsFor(state)[Number(event.target.value) - 1][0])}>{practiceHeatsFor(state).map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label><label>עמדה<select aria-label="עמדה לאימון פרטי" value={practiceParticipant} onChange={(event) => setPracticeParticipant(Number(event.target.value))}>{practiceHeatsFor(state)[practiceHeatFor(state, practiceParticipant) - 1].map((participant, index) => <option key={participant} value={participant}>עמדה {index + 1} · משתתף {participant}</option>)}</select></label></div></div><ScoreEditor state={state} setState={setState} practice round={practiceRound} participant={practiceParticipant} onComplete={nextPrivatePractice} /></section>}

    {tab === "settings" && <section className="settings-grid">
      <article className="panel"><p className="panel-label">בדיקה לפני ההתחלה</p><h2>מבנה הניסוי</h2><div className="form-grid">{([
        ["participantCount", "מספר משתתפים", 1, 30], ["dartCount", "חצים בסבב", 1, 20], ["practiceRounds", "סבבי אימון", 0, 20], ["competitionRounds", "סבבי תחרות", 1, 20],
        ["durationSeconds", "זמן זריקה בשניות", 3, 120], ["countdownSeconds", "ספירה לאחור", 0, 10], ["maxScore", "ניקוד מרבי לחץ", 1, 100], ["prizeAmount", "בונוס בהגרלה בשקלים", 0, 10000],
      ] as [keyof Settings, string, number, number][]).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} disabled={Boolean(state.prizeDraw)} value={state.settings[key]} onChange={(event) => updateSetting(key, clampInteger(Number(event.target.value), min, max))} /></label>)}</div><button className="primary start-experiment" disabled={Boolean(state.prizeDraw)} onClick={beginPractice}>אישור ההגדרות ומעבר לאימון</button></article>
      <article className="panel"><p className="panel-label">פרטי הרצה ושמירה</p><h2>גיבוי ויצוא</h2><label className="stacked-label">קוד הרצה<input value={state.sessionCode} onChange={(event) => setState((current) => ({ ...current, sessionCode: event.target.value }))} /></label><p className="field-help">הקוד נוצר אוטומטית משם הניסוי ומתאריך ההרצה.</p><div className="backup-card"><strong>גיבוי חי</strong><p>כל שינוי נשמר במחשב ומגובה מיד במאגר מקוון כאשר יש אינטרנט. כך ניתן לשחזר הרצה גם ממחשב אחר באמצעות קוד ההרצה.</p><button className="secondary" onClick={restoreFromLiveBackup}>שחזור לפי קוד ההרצה</button>{restoreMessage && <span>{restoreMessage}</span>}</div><label className="stacked-label">הערות וחריגים<textarea rows={5} value={state.notes} onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))} /></label>
        <div className="drive-card destination-card network-card"><strong>שמירה חיה לתיקיית האוניברסיטה</strong><div className="eduroam-notice"><b>ודא שמחובר לרשת ה-Wi-Fi ‏eduroam</b><span>ללא חיבור לרשת האוניברסיטה לא ניתן להגיע לתיקיית הנתונים.</span></div>
          <label className="stacked-label">נתיב תיקיית הנתונים
            <input ref={networkPathInput} className="network-path" value={networkPath}
              onChange={(event) => updateNetworkPath(event.target.value)}
              disabled={networkBusy} spellCheck={false} autoComplete="off" aria-describedby="network-path-help" />
          </label>
          <p id="network-path-help">העתיקו את הנתיב, לחצו על בחירת תיקיית רשת, והדביקו אותו בשורת הכתובת בחלון Windows. בחרו בתיקייה כדי להפעיל שמירה אוטומטית של קובץ ה-Excel.</p>
          {networkPathChanged && <p>הנתיב השתנה. השמירה לתיקייה הקודמת מושהית עד לבחירה מחדש.</p>}
          <div className="destination-actions">
            <button className="primary" disabled={networkBusy || !networkPath.trim()} onClick={() => void saveToNetwork(true)}>
              {networkFolder ? "החלפת תיקיית רשת" : "בחירת תיקיית רשת"}
            </button>
            <button className="secondary" disabled={!networkPath.trim()} onClick={copyNetworkPath}>העתקת הנתיב</button>
            {standalonePicker && <a href="/" target="_blank" rel="noopener noreferrer">פתיחת פוטוס בלשונית חדשה</a>}
          </div>
          <span className="drive-status" role="status">{networkStatus}</span>
          <label className="destination-option"><input type="checkbox" checked={saveToLocal} onChange={(event) => setSaveToLocal(event.target.checked)} /><span><b>תיקייה פיזית במחשב</b><small>עותק נוסף במיקום שתבחרו</small></span></label>
          {saveToLocal && <div className="destination-details"><button className="secondary" onClick={async () => { try { const handle = await chooseFolder("local-folder"); setLocalFolder(handle); setLocalStatus(`נבחרה תיקייה מקומית: ${handle.name}`); } catch { setLocalStatus("בחירת התיקייה המקומית בוטלה"); } }}>{localFolder ? "החלפת התיקייה המקומית" : "בחירת תיקייה מקומית"}</button><span className="drive-status">{localStatus}</span></div>}
          <button className="primary wide" onClick={saveWorkbookDestinations}>שמירה מיידית עכשיו</button>
        </div><div className="button-stack"><button className="secondary" onClick={() => exportWorkbook(state)}>הורדת Excel למחשב</button><button className="secondary" onClick={newSession}>פתיחת הרצה חדשה</button></div></article>
    </section>}
  </main>;
}
