"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type SharingSession } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";
import DeckViewer from "@/components/DeckViewer";

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sid = Number(id);
  const router = useRouter();
  const [s, setS] = useState<SharingSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSession(sid).then(setS).catch((e) => setError(String(e)));
  }, [sid]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!s) return <p className="text-sm text-text-subtle">Loading…</p>;

  const me = getStoredLearner();
  const canDelete = s.learner_id != null && me?.id === s.learner_id;

  async function remove() {
    if (!confirm("Delete this session?")) return;
    await api.deleteSession(sid, me?.id);
    router.push("/sessions");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sessions" className="text-xs text-text-subtle hover:text-text-muted">
          ← All sessions
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          {canDelete && (
            <div className="flex items-center gap-2">
              <Link href={`/sessions/${sid}/edit`} className="btn-ghost">
                Edit
              </Link>
              <button className="btn-ghost text-bad" onClick={remove}>Delete</button>
            </div>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-subtle">
          {s.presenter && <span>🎤 {s.presenter}</span>}
          {s.session_date && <span>{s.session_date}</span>}
          <span>posted by {s.author}</span>
        </div>
        {s.abstract && <p className="mt-3 text-text-subtle">{s.abstract}</p>}
        {s.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {s.tags.map((t) => (
              <span key={t} className="badge bg-edge text-text-subtle">{t}</span>
            ))}
          </div>
        )}
      </div>

      {s.recording_url && (
        <a href={s.recording_url} target="_blank" rel="noopener noreferrer" className="btn inline-flex">
          ▶ Watch recording
        </a>
      )}

      {s.has_deck && <DeckViewer sessionId={sid} originalName={s.file_original_name} />}

      {s.body_md && (
        <div className="card">
          <MarkdownLite>{s.body_md}</MarkdownLite>
        </div>
      )}
    </div>
  );
}
