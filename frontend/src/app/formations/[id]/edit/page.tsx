"use client";

import { use, useEffect, useState } from "react";
import { api, type Formation } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import FormationBuilder from "@/components/FormationBuilder";
import { useT } from "@/lib/i18n";

export default function EditFormation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const formationId = Number(id);
  const t = useT();
  const [formation, setFormation] = useState<Formation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const me = getStoredLearner();
    api.getFormation(formationId, me?.id).then(setFormation).catch((e) => setError(String(e)));
  }, [formationId]);

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!formation)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-9 w-64 skeleton" />
        <div className="h-96 skeleton rounded-2xl" />
      </div>
    );

  return (
    <FormationBuilder
      initial={formation}
      back={{ href: `/formations/${formationId}`, label: formation.title }}
      title={t("fb.editTitle")}
    />
  );
}
