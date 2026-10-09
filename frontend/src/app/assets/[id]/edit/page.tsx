"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Asset } from "@/lib/api";
import { ASSET_KINDS } from "@/lib/assetKinds";
import { getStoredLearner } from "@/lib/learner";

export default function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const assetId = Number(id);
  const me = getStoredLearner();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("idea");
  const [summary, setSummary] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [code, setCode] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getAsset(assetId)
      .then((a) => {
        setAsset(a);
        setTitle(a.title);
        setKind(a.kind);
        setSummary(a.summary);
        setBodyMd(a.body_md);
        setCode(a.code ?? "");
        setLink(a.link ?? "");
      })
      .catch((e) => setError(String(e)));
  }, [assetId]);

  if (error) return <div className="card border-bad/40 text-sm text-bad">{error}</div>;
  if (!asset) return <p className="text-sm text-text-subtle">Loading…</p>;
  if (!me || me.id !== asset.learner_id) {
    return (
      <div className="card text-center text-sm text-text-subtle">
        Only the author can edit this asset.
      </div>
    );
  }

  async function save() {
    if (!me) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateAsset(assetId, me.id, {
        title: title.trim(),
        kind,
        summary: summary.trim(),
        body_md: bodyMd,
        code: code.trim() || null,
        link: link.trim() || null,
      });
      router.push(`/assets/${assetId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit asset</h1>
        {asset.status === "rejected" && (
          <p className="mt-1 text-sm text-text-subtle">
            This asset was rejected
            {asset.review_note ? `: “${asset.review_note}”` : "."} Saving will resubmit it for
            review.
          </p>
        )}
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card space-y-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Title
          </label>
          <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Kind
          </label>
          <div className="flex flex-wrap gap-2">
            {ASSET_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`badge ${kind === k.id ? "bg-accent text-white" : "bg-edge text-text-muted"}`}
                onClick={() => setKind(k.id)}
              >
                {k.emoji} {k.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Summary
          </label>
          <input className="input w-full" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Details
          </label>
          <textarea
            className="input w-full"
            rows={8}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Code (optional)
          </label>
          <textarea
            className="input w-full font-mono text-sm"
            rows={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-text-subtle">
            Link (optional)
          </label>
          <input className="input w-full" value={link} onChange={(e) => setLink(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost btn-sm" onClick={() => router.push(`/assets/${assetId}`)}>
            Cancel
          </button>
          <button className="btn" disabled={saving || !title.trim()} onClick={save}>
            {saving ? "Saving…" : asset.status === "rejected" ? "Save & resubmit" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}