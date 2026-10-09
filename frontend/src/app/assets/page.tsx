"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type AssetSummary } from "@/lib/api";
import { ASSET_KINDS, kindMeta } from "@/lib/assetKinds";
import ListFilter, { useListFilter } from "@/components/ListFilter";
import { useI18n } from "@/lib/i18n";
import { getStoredLearner } from "@/lib/learner";

export default function AssetsCatalog() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [reviewQueue, setReviewQueue] = useState<AssetSummary[]>([]);
  const [kind, setKind] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const me = getStoredLearner();

  const load = useCallback(() => {
    api
      .listAssets({ kind: kind || undefined, learnerId: me?.id })
      .then(setAssets)
      .catch((e) => setError(String(e)));
       if (me) {
      api.listAssets({ learnerId: me.id, pendingReview: true }).then(setReviewQueue).catch(() => {});
      }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  const filter = useListFilter(assets, (a) => ({
    haystack: [a.title, a.summary, a.author, (a.tags ?? []).join(" ")].join(" "),
    tags: a.tags ?? [],
  }));

  async function review(assetId: number, decision: "approve" | "reject") {
    if (!me) return;
    const note = decision === "reject" ? window.prompt("Motif du rejet :") ?? "" : "";
    await api.reviewAsset(assetId, me.id, decision, note);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assets</h1>
          <p className="mt-1 text-sm text-text-subtle">
            The team&apos;s shared AI &amp; data work — notebooks, code, models, datasets, and ideas.
            Don&apos;t let good work die on one laptop.
          </p>
        </div>
        <Link href="/assets/new" className="btn shrink-0">
          + Share an asset
        </Link>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {reviewQueue.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-medium">À valider</h2>
          {reviewQueue.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 border-t border-edge pt-2">
              <span>{a.title} — {a.author}</span>
              <div className="flex gap-2">
                <button className="btn-soft btn-sm" onClick={() => review(a.id, "approve")}>Approuver</button>
                <button className="btn-ghost btn-sm" onClick={() => review(a.id, "reject")}>Rejeter</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`badge ${kind === "" ? "bg-accent text-white" : "bg-edge text-text-muted"}`}
          onClick={() => setKind("")}
        >
          All
        </button>
        {ASSET_KINDS.map((k) => (
          <button
            key={k.id}
            className={`badge ${kind === k.id ? "bg-accent text-white" : "bg-edge text-text-muted"}`}
            onClick={() => setKind(k.id)}
          >
            {k.emoji} {k.label}
          </button>
        ))}
      </div>

      <ListFilter
        placeholder={t("filter.assets")}
        {...filter}
        total={assets.length}
        shown={filter.filtered.length}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filter.filtered.map((a) => {
          const m = kindMeta(a.kind);
          return (
            <Link key={a.id} href={`/assets/${a.id}`} className="card group flex flex-col gap-2 transition hover:border-accent">
              <div className="flex items-center justify-between">
                <span className="text-2xl">{m.emoji}</span>
                <span className="badge bg-edge text-text-subtle">{m.label}</span>
              </div>
              <h3 className="font-medium group-hover:text-accent">{a.title}</h3>
                {a.status === "pending" && <span className="badge bg-warn/15 text-warn">En attente</span>}
                {a.status === "rejected" && <span className="badge bg-bad/15 text-bad">{t("common.rejected")}</span>}
              <p className="line-clamp-2 text-sm text-text-subtle">{a.summary}</p>
              <div className="mt-auto flex items-center justify-between pt-2 text-xs text-text-subtle">
                <span>by {a.author}</span>
                <span>{new Date(a.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          );
        })}
      </div>
      {filter.filtered.length === 0 && !error && (
        <p className="text-sm text-text-subtle">
          {assets.length ? t("filter.noMatch") : t("assets.empty")}
        </p>
      )}
    </div>
  );
}
