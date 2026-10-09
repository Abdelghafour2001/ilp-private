"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Formation } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import FormationBuilder from "@/components/FormationBuilder";

export default function EditFormation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const formationId = Number(id);
  const [formation, setFormation] = useState<Formation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const me = getStoredLearner();
    api.getFormation(formationId, me?.id).then(setFormation).catch((e) => setError(String(e)));
  }, [formationId]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!formation) return <p className="text-sm text-text-subtle">Loading…</p>;

  return (
    <div className="space-y-4">
      <Link href={`/formations/${formationId}`} className="text-xs text-text-subtle hover:text-text">
        ← {formation.emoji} {formation.title}
      </Link>
      <h1 className="text-2xl font-semibold">Edit training</h1>
      <FormationBuilder initial={formation} />
    </div>
  );
}
