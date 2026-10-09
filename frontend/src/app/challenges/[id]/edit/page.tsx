"use client";

/**
 * Correct a challenge in place.
 *
 * Deleting and re-posting also threw away the submissions and votes attached
 * to the brief, so in practice a wrong date stayed wrong. Same permission as
 * deleting: the author, or an admin (the server enforces it).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type ChallengeDetail } from "@/lib/api";
import ChallengeForm from "@/components/forms/ChallengeForm";

export default function EditChallenge() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<ChallengeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getChallenge(Number(id)).then(setItem).catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
  return <ChallengeForm initial={item} />;
}
