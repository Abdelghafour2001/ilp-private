"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type LabDefinition } from "@/lib/api";
import LabEditor from "@/components/LabEditor";

export default function EditLab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ definition: LabDefinition; published: boolean; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminGetLab(id).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/labs" className="text-xs text-text-subtle hover:text-text-muted">
          ← Manage labs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit lab</h1>
        {data?.source === "file" && (
          <p className="mt-1 text-sm text-warn">
            This is a file lab — saving creates a DB copy that overrides the file.
          </p>
        )}
      </div>
      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {data && <LabEditor initial={{ definition: data.definition, published: data.published }} lockId />}
    </div>
  );
}
