"use client";

/**
 * Correct an archived session, deck included.
 *
 * Replacing the deck is an edit like any other — slides get fixed after the
 * talk — and the alternative was deleting the session, losing its URL and
 * re-uploading everything. Leaving the file picker empty keeps the deck that
 * is already attached.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, type SharingSession } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

export default function EditSession() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState({
    title: "",
    abstract: "",
    body_md: "",
    presenter: "",
    session_date: "",
    tags: "",
    recording_url: "",
  });
  const [session, setSession] = useState<SharingSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = getStoredLearner();

  useEffect(() => {
    api
      .getSession(Number(id))
      .then((s) => {
        setSession(s);
        setForm({
          title: s.title,
          abstract: s.abstract ?? "",
          body_md: s.body_md ?? "",
          presenter: s.presenter ?? "",
          session_date: s.session_date ?? "",
          tags: (s.tags ?? []).join(", "),
          recording_url: s.recording_url ?? "",
        });
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  function set(key: keyof typeof form, value: string) {
    setForm({ ...form, [key]: value });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const deck = file ? await api.uploadDeck(file) : null;
      await api.updateSession(Number(id), {
        title: form.title,
        abstract: form.abstract,
        body_md: form.body_md,
        presenter: form.presenter,
        session_date: form.session_date || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        recording_url: form.recording_url || null,
        file_name: deck?.file_name ?? null,
        file_original_name: deck?.file_original_name ?? null,
        learner_id: me?.id ?? null,
      });
      router.push(`/sessions/${id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !session) return <div className="card text-sm text-bad">{error}</div>;
  if (!session) return <p className="text-sm text-text-subtle">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/sessions/${id}`} className="text-xs text-text-subtle hover:text-text">
          ← Back to the session
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit session</h1>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-3">
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => set("title", e.target.value)} />
        <input
          className="input"
          placeholder="One-line abstract"
          value={form.abstract}
          onChange={(e) => set("abstract", e.target.value)}
        />
        <textarea
          className="input h-40 font-mono text-xs"
          placeholder="Write-up (markdown)"
          value={form.body_md}
          onChange={(e) => set("body_md", e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-text-muted">
            Presenter
            <input className="input mt-1" value={form.presenter} onChange={(e) => set("presenter", e.target.value)} />
          </label>
          <label className="text-xs text-text-muted">
            Date
            <input
              className="input mt-1"
              type="date"
              value={form.session_date}
              onChange={(e) => set("session_date", e.target.value)}
            />
          </label>
          <label className="text-xs text-text-muted">
            Recording URL
            <input
              className="input mt-1"
              value={form.recording_url}
              onChange={(e) => set("recording_url", e.target.value)}
            />
          </label>
        </div>
        <input
          className="input"
          placeholder="Tags (comma-separated)"
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
        />

        <label className="block text-xs text-text-muted">
          Slide deck
          <input
            className="mt-1 block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-edge file:px-3 file:py-2 file:text-text"
            type="file"
            accept=".pdf,.pptx,.ppt,.key"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="mt-1 block text-xs text-text-subtle">
            {file
              ? `Replacing with ${file.name}`
              : session.file_original_name
                ? `Keeping ${session.file_original_name} — pick a file to replace it.`
                : "No deck attached."}
          </span>
        </label>

        <div className="flex gap-2">
          <button className="btn" onClick={save} disabled={busy || !form.title.trim()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <Link href={`/sessions/${id}`} className="btn-ghost">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
