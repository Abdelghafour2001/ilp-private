"use client";

/**
 * Correct a challenge in place.
 *
 * Deleting and re-posting also threw away the submissions and votes attached
 * to the brief, so in practice a wrong date stayed wrong. Same permission as
 * deleting: the author, or an admin.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, type ChallengeDetail } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

export default function EditChallenge() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState({
    title: "",
    summary: "",
    brief_md: "",
    theme: "",
    prize: "",
    deadline: "",
    tags: "",
  });
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = getStoredLearner();

  useEffect(() => {
    api
      .getChallenge(Number(id))
      .then((c) => {
        setChallenge(c);
        setForm({
          title: c.title,
          summary: c.summary,
          brief_md: c.brief_md ?? "",
          theme: c.theme ?? "",
          prize: c.prize ?? "",
          deadline: c.deadline ?? "",
          tags: (c.tags ?? []).join(", "),
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
      await api.updateChallenge(Number(id), {
        title: form.title,
        summary: form.summary,
        brief_md: form.brief_md,
        theme: form.theme || "General",
        prize: form.prize || null,
        deadline: form.deadline || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        learner_id: me?.id ?? null,
      });
      router.push(`/challenges/${id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !challenge) return <div className="card text-sm text-bad">{error}</div>;
  if (!challenge) return <p className="text-sm text-text-subtle">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/challenges/${id}`} className="text-xs text-text-subtle hover:text-text">
          ← Back to the challenge
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit challenge</h1>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-3">
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => set("title", e.target.value)} />
        <input className="input" placeholder="One-line summary" value={form.summary} onChange={(e) => set("summary", e.target.value)} />
        <textarea
          className="input h-40 font-mono text-xs"
          placeholder="The brief (markdown)"
          value={form.brief_md}
          onChange={(e) => set("brief_md", e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-text-muted">
            Theme
            <input className="input mt-1" value={form.theme} onChange={(e) => set("theme", e.target.value)} />
          </label>
          <label className="text-xs text-text-muted">
            Prize / recognition
            <input className="input mt-1" value={form.prize} onChange={(e) => set("prize", e.target.value)} />
          </label>
          <label className="text-xs text-text-muted">
            Deadline
            <input className="input mt-1" type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </label>
        </div>
        <input
          className="input"
          placeholder="Tags (comma-separated)"
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
        />
        <div className="flex gap-2">
          <button className="btn" onClick={save} disabled={busy || !form.title.trim()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <Link href={`/challenges/${id}`} className="btn-ghost">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
