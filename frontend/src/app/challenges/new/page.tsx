"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { claimHandle, getStoredLearner } from "@/lib/learner";

export default function NewChallenge() {
  const router = useRouter();
  const [f, setF] = useState({
    title: "",
    summary: "",
    brief_md: "",
    theme: "General",
    prize: "",
    deadline: "",
    tags: "",
  });
  const [handle, setHandle] = useState(getStoredLearner()?.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = getStoredLearner();

  function set(k: keyof typeof f, v: string) {
    setF({ ...f, [k]: v });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let learner = me;
      if (!learner) {
        if (handle.trim().length < 2) throw new Error("Pick a handle first.");
        learner = await claimHandle(handle);
      }
      const c = await api.createChallenge({
        title: f.title,
        summary: f.summary,
        brief_md: f.brief_md,
        theme: f.theme || "General",
        prize: f.prize || null,
        deadline: f.deadline || null,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        learner_id: learner.id,
        author: learner.handle,
      });
      router.push(`/challenges/${c.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/challenges" className="text-xs text-text-subtle hover:text-text-muted">
          ← All challenges
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Post a challenge</h1>
        <p className="mt-1 text-sm text-text-subtle">Frame a problem worth solving and let the team run at it.</p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-3">
        <input className="input" placeholder="Title" value={f.title} onChange={(e) => set("title", e.target.value)} />
        <input className="input" placeholder="One-line summary" value={f.summary} onChange={(e) => set("summary", e.target.value)} />
        <textarea className="input h-40 font-mono text-xs" placeholder="The brief (markdown): context, goals, constraints, how it'll be judged" value={f.brief_md} onChange={(e) => set("brief_md", e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-text-subtle">
            Theme
            <input className="input mt-1" value={f.theme} onChange={(e) => set("theme", e.target.value)} />
          </label>
          <label className="text-xs text-text-subtle">
            Prize / recognition
            <input className="input mt-1" value={f.prize} onChange={(e) => set("prize", e.target.value)} />
          </label>
          <label className="text-xs text-text-subtle">
            Deadline
            <input className="input mt-1" type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </label>
        </div>
        <input className="input" placeholder="Tags (comma-separated)" value={f.tags} onChange={(e) => set("tags", e.target.value)} />
        {!me && <input className="input max-w-xs" placeholder="your handle" value={handle} onChange={(e) => setHandle(e.target.value)} />}
        <button className="btn" onClick={submit} disabled={busy || !f.title.trim()}>
          {busy ? "Posting…" : "Post challenge"}
        </button>
      </div>
    </div>
  );
}
