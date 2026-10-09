"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type ChallengeDetail, type Submission } from "@/lib/api";
import { claimHandle, getStoredLearner } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";

export default function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = Number(id);
  const router = useRouter();
  const [c, setC] = useState<ChallengeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getChallenge(cid).then(setC).catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, [cid]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!c) return <p className="text-sm text-text-subtle">Loading…</p>;

  const me = getStoredLearner();
  const canManage = c.learner_id != null && me?.id === c.learner_id;

  async function remove() {
    if (!confirm("Delete this challenge?")) return;
    await api.deleteChallenge(cid, me?.id);
    router.push("/challenges");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/challenges" className="text-xs text-text-subtle hover:text-text-muted">
          ← All challenges
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <div className="flex items-center gap-2">
            <span className={`badge ${c.status === "open" ? "bg-good/15 text-good" : "bg-edge text-text-subtle"}`}>{c.status}</span>
            {canManage && (
              <>
                <Link href={`/challenges/${cid}/edit`} className="btn-ghost">
                  Edit
                </Link>
                <button className="btn-ghost text-bad" onClick={remove}>Delete</button>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-subtle">
          <span>{c.theme}</span>
          {c.prize && <span>🏆 {c.prize}</span>}
          {c.deadline && <span>due {c.deadline}</span>}
          <span>by {c.author}</span>
        </div>
      </div>

      {c.brief_md && (
        <div className="card">
          <MarkdownLite>{c.brief_md}</MarkdownLite>
        </div>
      )}

      {c.status === "open" && <SubmitForm challengeId={cid} onDone={load} />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
          Submissions ({c.submissions.length})
        </h2>
        {c.submissions.map((s) => (
          <SubmissionCard key={s.id} submission={s} onChange={load} />
        ))}
        {c.submissions.length === 0 && <p className="text-sm text-text-subtle">No submissions yet — be first.</p>}
      </section>
    </div>
  );
}

function SubmitForm({ challengeId, onDone }: { challengeId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", summary: "", body_md: "", link: "" });
  const [handle, setHandle] = useState(getStoredLearner()?.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let me = getStoredLearner();
      if (!me) {
        if (handle.trim().length < 2) throw new Error("Pick a handle first.");
        me = await claimHandle(handle);
      }
      await api.submitToChallenge(challengeId, { ...f, link: f.link || null, learner_id: me.id, author: me.handle });
      setF({ title: "", summary: "", body_md: "", link: "" });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        💡 Submit an idea
      </button>
    );
  }

  const me = getStoredLearner();
  return (
    <div className="card space-y-3">
      <h3 className="font-medium">Your submission</h3>
      {error && <p className="text-sm text-bad">{error}</p>}
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input className="input" placeholder="One-line summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      <textarea className="input h-28 font-mono text-xs" placeholder="Describe your idea (markdown)" value={f.body_md} onChange={(e) => setF({ ...f, body_md: e.target.value })} />
      <input className="input" placeholder="Link (repo, doc, demo… optional)" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
      {!me && <input className="input max-w-xs" placeholder="your handle" value={handle} onChange={(e) => setHandle(e.target.value)} />}
      <div className="flex gap-2">
        <button className="btn" onClick={submit} disabled={busy || !f.title.trim()}>
          {busy ? "Submitting…" : "Submit"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function SubmissionCard({ submission, onChange }: { submission: Submission; onChange: () => void }) {
  const [votes, setVotes] = useState(submission.votes);
  const me = getStoredLearner();

  async function vote() {
    let learner = me;
    if (!learner) {
      const h = prompt("Pick a handle to vote:");
      if (!h || h.trim().length < 2) return;
      learner = await claimHandle(h);
    }
    const r = await api.voteSubmission(submission.id, learner.id);
    setVotes(r.votes);
  }

  async function remove() {
    if (!confirm("Delete this submission?")) return;
    await api.deleteSubmission(submission.id, me?.id);
    onChange();
  }

  return (
    <div className="card flex gap-4">
      <button
        onClick={vote}
        className="flex shrink-0 flex-col items-center justify-start rounded-lg border border-edge px-3 py-2 transition hover:border-accent hover:text-accent"
      >
        <span>▲</span>
        <span className="text-sm font-semibold">{votes}</span>
      </button>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{submission.title}</h3>
          {me?.id === submission.learner_id && (
            <button className="text-xs text-text-subtle hover:text-bad" onClick={remove}>✕</button>
          )}
        </div>
        <p className="text-xs text-text-subtle">by {submission.author}</p>
        {submission.summary && <p className="mt-1 text-sm text-text-muted">{submission.summary}</p>}
        {submission.body_md && (
          <div className="mt-2">
            <MarkdownLite>{submission.body_md}</MarkdownLite>
          </div>
        )}
        {submission.link && (
          <a href={submission.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">
            🔗 {submission.link}
          </a>
        )}
      </div>
    </div>
  );
}
