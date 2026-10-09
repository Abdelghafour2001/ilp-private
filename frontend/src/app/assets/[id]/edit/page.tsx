"use client";

/**
 * Edit a shared asset. Only its author may; a rejected asset goes back to
 * review when it is saved.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Asset } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import AssetForm from "@/components/forms/AssetForm";

function OnlyAuthor() {
  const t = useT();
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
      {t("asset.edit.onlyAuthor")}
    </div>
  );
}

export default function EditAssetPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAsset(Number(id)).then(setItem).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!item)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-4 w-32 skeleton" />
        <div className="h-9 w-72 skeleton" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="h-96 skeleton rounded-2xl" />
          <div className="h-64 skeleton rounded-2xl" />
        </div>
      </div>
    );
  if (getStoredLearner()?.id !== item.learner_id)
    return <OnlyAuthor />;
  return <AssetForm initial={item} />;
}
