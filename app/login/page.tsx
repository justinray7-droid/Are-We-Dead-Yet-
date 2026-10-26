"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      // The database refuses anyone not on the members list.
      setMessage("That email isn't one of the three members of this bet.");
    } else {
      setState("sent");
    }
  }

  return (
    <main className="narrow">
      <h1>2031 AI Wager</h1>
      <p className="muted">Private tracker for Alex, Justin and Shaun.</p>
      {state === "sent" ? (
        <p className="card">Check your email for a sign-in link. You can close this tab.</p>
      ) : (
        <form onSubmit={send} className="card stack">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {state === "error" && <p className="error">{message}</p>}
        </form>
      )}
    </main>
  );
}
