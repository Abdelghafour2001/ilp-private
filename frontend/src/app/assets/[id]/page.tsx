"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Asset } from "@/lib/api";
import { kindMeta } from "@/lib/assetKinds";
import { getStoredLearner } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";
import CodeBlock from "@/components/CodeBlock";

export default function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAsset(Number(id)).then(setAsset).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!asset) return <p className="text-sm text-text-subtle">Loading…</p>;

  const m = kindMeta(asset.kind);
  const me = getStoredLearner();
  const canDelete = asset.learner_id != null && me?.id === asset.learner_id;

  async function remove() {
    if (!confirm("Delete this asset?")) return;
    await api.deleteAsset(asset!.id, me?.id);
    router.push("/assets");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/assets" className="text-xs text-text-subtle hover:text-text-muted">
          ← All assets
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{m.emoji}</span>
            <h1 className="text-2xl font-semibold">{asset.title}</h1>
            <span className="badge bg-edge text-text-muted">{m.label}</span>
           
          </div>
        
         <div className="flex gap-2">
          {canDelete && (
            <div className="flex gap-2">
              <Link href={`/assets/${asset.id}/edit`} className="btn-ghost btn-sm">
                Edit
              </Link>
              <button className="btn-ghost btn-sm text-bad" onClick={remove}>
                Delete
              </button>
            </div>
          )}
          </div>
        </div>
        <p className="mt-2 text-text-subtle">{asset.summary}</p>
        <p className="mt-1 text-xs text-text-subtle">
          by {asset.author} · {new Date(asset.created_at).toLocaleDateString()}
        </p>
        {asset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {asset.tags.map((t) => (
              <span key={t} className="badge bg-edge text-text-subtle">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {asset.link && (
        <a href={asset.link} target="_blank" rel="noopener noreferrer" className="btn inline-flex">
          🔗 Open resource
        </a>
      )}

      {asset.body_md && (
        <div className="card">
          <MarkdownLite>{asset.body_md}</MarkdownLite>
        </div>
      )}

      {asset.code && <CodeBlock code={asset.code} language="code" filename="snippet" />}
    </div>
  );
}
