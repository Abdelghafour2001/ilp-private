"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { claimHandle, getStoredLearner } from "@/lib/learner";

export default function NewSession() {
  const router = useRouter();
  const [f, setF] = useState({
    title: "",
    abstract: "",
    body_md: "",
    presenter: "",
    session_date: "",
    tags: "",
    recording_url: "",
  });
  const [file, setFile] = useState<File | null>(null);
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

      let deck: { file_name: string; file_original_name: string } | null = null;
      if (file) deck = await api.uploadDeck(file);

      const s = await api.createSession({
        title: f.title,
        abstract: f.abstract,
        body_md: f.body_md,
        presenter: f.presenter || learner.handle,
        session_date: f.session_date || null,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        file_name: deck?.file_name ?? null,
        file_original_name: deck?.file_original_name ?? null,
        recording_url: f.recording_url || null,
        learner_id: learner.id,
        author: learner.handle,
      });
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sessions" className="text-xs text-text-subtle hover:text-text-muted">
          ← All sessions
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Post a sharing session</h1>
        <p className="mt-1 text-sm text-text-subtle">Archive a presentation so the team can review it later.</p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-3">
        <input className="input" placeholder="Title" value={f.title} onChange={(e) => set("title", e.target.value)} />
        <input className="input" placeholder="One-line abstract" value={f.abstract} onChange={(e) => set("abstract", e.target.value)} />
        <textarea className="input h-32 font-mono text-xs" placeholder="Write-up / notes (markdown)" value={f.body_md} onChange={(e) => set("body_md", e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-subtle">
            Presenter
            <input className="input mt-1" value={f.presenter} onChange={(e) => set("presenter", e.target.value)} />
          </label>
          <label className="text-xs text-text-subtle">
            Session date
            <input className="input mt-1" type="date" value={f.session_date} onChange={(e) => set("session_date", e.target.value)} />
          </label>
        </div>
        <input className="input" placeholder="Tags (comma-separated)" value={f.tags} onChange={(e) => set("tags", e.target.value)} />
        <input className="input" placeholder="Recording URL (optional)" value={f.recording_url} onChange={(e) => set("recording_url", e.target.value)} />

        <label className="text-xs text-text-subtle">
          Slide deck (PPTX / PDF / PPT / Key — optional, max 60 MB)
          <input
            className="mt-1 block w-full text-sm text-text-subtle file:mr-3 file:rounded-lg file:border-0 file:bg-edge file:px-3 file:py-2 file:text-text"
            type="file"
            accept=".pptx,.ppt,.pdf,.key"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {!me && <input className="input max-w-xs" placeholder="your handle" value={handle} onChange={(e) => setHandle(e.target.value)} />}
        <button className="btn" onClick={submit} disabled={busy || !f.title.trim()}>
          {busy ? "Posting…" : "Post session"}
        </button>
      </div>
    </div>
  );
}
