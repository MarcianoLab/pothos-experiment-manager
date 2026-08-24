"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHANNEL_NAME,
  createExperiment,
  ExperimentState,
  normalizeState,
  STORAGE_KEY,
} from "./experiment";

export type SaveStatus = "local" | "syncing" | "cloud" | "offline";

export function useExperiment(readOnly = false) {
  const [state, setState] = useState<ExperimentState>(() => createExperiment());
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("local");
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState(normalizeState(JSON.parse(saved)));
    } catch {
      // A damaged local draft should never prevent a new session from starting.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (readOnly && event.data?.type === "state") setState(normalizeState(event.data.state));
    };
    return () => channel.close();
  }, [readOnly]);

  useEffect(() => {
    if (!hydrated || readOnly) return;
    const next = { ...state, updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    channelRef.current?.postMessage({ type: "state", state: next });
    const timeout = window.setTimeout(async () => {
      setSaveStatus("syncing");
      try {
        const response = await fetch("/api/experiments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error("Cloud save failed");
        setSaveStatus("cloud");
      } catch {
        setSaveStatus("offline");
      }
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [state, hydrated, readOnly]);

  useEffect(() => {
    if (!hydrated || readOnly) return;
    const syncWhenOnline = () => setState((current) => ({ ...current }));
    window.addEventListener("online", syncWhenOnline);
    return () => window.removeEventListener("online", syncWhenOnline);
  }, [hydrated, readOnly]);

  const replaceState = useCallback((next: ExperimentState) => {
    setState(normalizeState(next));
  }, []);

  return { state, setState, replaceState, hydrated, saveStatus };
}
