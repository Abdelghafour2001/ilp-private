"use client";

/**
 * Correct an archived session, deck included.
 *
 * Replacing the deck is an edit like any other — slides get fixed after the
 * talk — and the alternative was deleting the session, losing its URL and
 * re-uploading everything. Leaving the file empty keeps the deck attached.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type SharingSession } from "@/lib/api";
import SessionForm from "@/components/forms/SessionForm";

export default function EditSession() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<SharingSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSession(Number(id)).then(setItem).catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
  return <SessionForm initial={item} />;
}
