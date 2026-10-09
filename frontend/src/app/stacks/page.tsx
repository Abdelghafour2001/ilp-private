"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type StackSummary } from "@/lib/api";

const DIFFICULTY: Record<string, string> = {
  intermediate: "bg-warn/15 text-warn",
  advanced: "bg-bad/15 text-bad",
  expert: "bg-accent/15 text-accent",
};

export default function StacksCatalog() {
  const [stacks, setStacks] = useState<StackSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listStacks().then(setStacks).catch((e) => setError(String(e)));
  }, []);

  const categories = Array.from(new Set(stacks.map((s) => s.category)));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Stacks</h1>
        <p className="mt-1 text-sm text-text-subtle">
          Copy-paste-ready local setups for real data tools, with professional use cases. Spin up
          Kafka, dbt, Neo4j, Spark, Airflow, a Trino lakehouse, and more on your laptop.
        </p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {stacks.length === 0 && !error && (
        <p className="text-sm text-text-subtle">No stacks found in <code>backend/stacks/</code>.</p>
      )}

      {categories.map((cat) => (
        <section key={cat} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">{cat}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stacks
              .filter((s) => s.category === cat)
              .map((s) => (
                <Link
                  key={s.id}
                  href={`/stacks/${s.id}`}
                  className="card group flex flex-col gap-2 transition hover:border-accent"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl">{s.emoji}</span>
                    <span className={`badge ${DIFFICULTY[s.difficulty] ?? "bg-edge text-text-subtle"}`}>
                      {s.difficulty}
                    </span>
                  </div>
                  <h3 className="font-medium group-hover:text-accent">{s.name}</h3>
                  <p className="text-sm text-text-subtle">{s.summary}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-2">
                    {s.tags.slice(0, 3).map((t) => (
                      <span key={t} className="badge bg-edge text-text-subtle">
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
