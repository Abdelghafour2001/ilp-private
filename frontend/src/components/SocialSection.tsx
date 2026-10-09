"use client";

/**
 * SocialSection — like / share buttons + comment thread for a course or
 * training. Drop it at the bottom of a detail page; it loads its own state.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type SocialEntity, type SocialState } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins < 1 ? "just now" : `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function SocialSection({ etype, eid }: { etype: SocialEntity; eid: number }) {
  const [state, setState] = useState<SocialState | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = getStoredLearner();

  const load = useCallback(() => {
    api.socialState(etype, eid, getStoredLearner()?.id).then(setState).catch(() => {});
  }, [etype, eid]);

  useEffect(() => {
    load();
  }, [load]);

  async function like() {
    if (!me || !state) return;
    // optimistic flip
    setState({
      ...state,
      liked_by_me: !state.liked_by_me,
      likes: state.likes + (state.liked_by_me ? -1 : 1),
    });
    await api.toggleLike(etype, eid, me.id).catch(() => load());
  }

  async function rate(stars: number) {
    if (!me || !state) return;
    const prev = state;
    // optimistic update — we don't know the new average precisely, so we
    // just reflect "my_stars" instantly and reconcile with the real
    // avg/count once the request resolves.
    setState({ ...state, my_stars: stars });
    try {
      const r = await api.rateEntity(etype, eid, me.id, stars);
      setState((s) => (s ? { ...s, avg_stars: r.avg_stars, reviews_count: r.reviews_count, my_stars: r.my_stars } : s));
    } catch {
      setState(prev);
      load();
    }
  }

  async function shareIt() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable — still record the share */
    }
    if (me) {
      const r = await api.recordShare(etype, eid, me.id).catch(() => null);
      if (r && state) setState({ ...state, shares: r.shares, shared_by_me: true });
    }
  }

  async function submit() {
    if (!me || !draft.trim()) return;
    setBusy(true);
    try {
      await api.addComment(etype, eid, me.id, draft.trim());
      setDraft("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this comment?")) return;
    await api.deleteComment(id, me?.id ?? undefined).catch(() => {});
    load();
  }

  if (!state) return null;

  return (
    <div className="card space-y-3">
      {/* engagement bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`btn-ghost btn-sm ${state.liked_by_me ? "border-accent bg-accent/10 text-accent-text" : ""}`}
          disabled={!me}
          title={me ? "" : "Sign in to like"}
          onClick={like}
        >
          {state.liked_by_me ? "👍 Liked" : "👍 Like"} · {state.likes}
        </button>

        <div className="flex items-center gap-0.5" title={me ? "Rate this content" : "Sign in to rate"}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              disabled={!me}
              onClick={() => rate(n)}
              className={`text-lg leading-none disabled:cursor-not-allowed ${
                n <= (state.my_stars ?? 0) ? "text-warn" : "text-edge hover:text-warn/60"
              }`}
            >
              ★
            </button>
          ))}
          <span className="ml-1 text-xs text-text-subtle">
            {state.avg_stars !== null ? `${state.avg_stars} (${state.reviews_count})` : "No ratings yet"}
          </span>
        </div>

        <button className="btn-ghost btn-sm" onClick={shareIt}>
          {copied ? "✓ Link copied!" : "🔗 Share"} · {state.shares}
        </button>
        <span className="text-sm text-text-subtle">💬 {state.comments.length} comment{state.comments.length === 1 ? "" : "s"}</span>
      </div>

      {/* new comment */}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={me ? "Ask a question or leave feedback…" : "Sign in (top-right) to comment"}
          disabled={!me}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn-soft" disabled={busy || !me || !draft.trim()} onClick={submit}>
          Post
        </button>
      </div>

      {/* thread */}
      <div className="space-y-2">
        {state.comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-text-muted">
              {(c.name || c.handle).split(/[\s.]+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-subtle">
                <strong className="text-text">{c.name || c.handle}</strong> · {ago(c.created_at)}
              </p>
              <p className="text-sm text-text-muted">{c.body}</p>
            </div>
            {(me?.id === c.learner_id || me?.role === "admin" || me?.role === "hr") && (
              <button className="text-xs text-bad hover:underline" onClick={() => remove(c.id)}>
                delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
