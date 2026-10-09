"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ASSET_KINDS } from "@/lib/assetKinds";
import { claimHandle, getStoredLearner } from "@/lib/learner";

export default function NewAsset() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    kind: "idea",
    summary: "",
    body_md: "",
    code: "",
    link: "",
    tags: "",
  });
  const [handle, setHandle] = useState(getStoredLearner()?.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm({ ...form, [k]: v });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let learner = getStoredLearner();
      if (!learner) {
        if (handle.trim().length < 2) throw new Error("Pick a handle so people know who shared it.");
        learner = await claimHandle(handle);
      }
      const asset = await api.createAsset({
        title: form.title,
        kind: form.kind,
        summary: form.summary,
        body_md: form.body_md,
        code: form.code || null,
        link: form.link || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        learner_id: learner.id,
        author: learner.handle,
      });
      router.push(`/assets/${asset.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const me = getStoredLearner();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/assets" className="text-xs text-text-subtle hover:text-text-muted">
          ← All assets
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Share an asset</h1>
        <p className="mt-1 text-sm text-text-subtle">
          Post a notebook, code snippet, model, dataset, or idea so the team can find and reuse it.
        </p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-text-subtle sm:col-span-2">
            Title
            <input className="input mt-1" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="text-xs text-text-subtle">
            Type
            <select className="input mt-1" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {ASSET_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.emoji} {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-xs text-text-subtle">
          One-line summary
          <input className="input mt-1" value={form.summary} onChange={(e) => set("summary", e.target.value)} />
        </label>

        <label className="text-xs text-text-subtle">
          Description (markdown — what it does, how to use it)
          <textarea className="input mt-1 h-32 font-mono text-xs" value={form.body_md} onChange={(e) => set("body_md", e.target.value)} />
        </label>

        <label className="text-xs text-text-subtle">
          Link (repo, notebook, drive… optional)
          <input className="input mt-1" placeholder="https://…" value={form.link} onChange={(e) => set("link", e.target.value)} />
        </label>

        <label className="text-xs text-text-subtle">
          Code snippet (optional)
          <textarea className="input mt-1 h-28 font-mono text-xs" value={form.code} onChange={(e) => set("code", e.target.value)} />
        </label>

        <label className="text-xs text-text-subtle">
          Tags (comma-separated)
          <input className="input mt-1" placeholder="rag, embeddings, internal" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </label>

        {!me && (
          <label className="text-xs text-text-subtle">
            Your handle (so people know who shared it)
            <input className="input mt-1 max-w-xs" value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
        )}

        <button className="btn" onClick={submit} disabled={busy || !form.title.trim()}>
          {busy ? "Sharing…" : "Share it"}
        </button>
      </div>
    </div>
  );
}
