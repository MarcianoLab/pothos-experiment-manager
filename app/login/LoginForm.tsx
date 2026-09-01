"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

function safeNextPath(): string {
  const requested = new URLSearchParams(window.location.search).get("next");
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
}

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "הקוד שהוזן אינו נכון" : "לא ניתן להתחבר כרגע. נסו שוב.");
        setCode("");
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      window.location.replace(safeNextPath());
    } catch {
      setError("לא ניתן להתחבר כרגע. בדקו את החיבור ונסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-shell" dir="rtl">
      <section className="access-card" aria-labelledby="access-title">
        <p className="access-brand">Pothos</p>
        <h1 id="access-title">כניסה למערכת הניסוי</h1>
        <p className="access-copy">הזינו את קוד הגישה כדי לפתוח את מערכת הניהול.</p>
        <form onSubmit={submit} className="access-form">
          <label htmlFor="access-code">קוד גישה</label>
          <input
            ref={inputRef}
            id="access-code"
            name="access-code"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            aria-describedby={error ? "access-error" : undefined}
          />
          {error && <p id="access-error" className="access-error" role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={!code || submitting}>
            {submitting ? "בודק…" : "כניסה למערכת"}
          </button>
        </form>
      </section>
    </main>
  );
}
