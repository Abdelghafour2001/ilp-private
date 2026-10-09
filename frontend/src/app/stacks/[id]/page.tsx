"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type StackRecipe } from "@/lib/api";
import MarkdownLite from "@/components/MarkdownLite";
import CodeBlock from "@/components/CodeBlock";

export default function StackDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [stack, setStack] = useState<StackRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getStack(id).then(setStack).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!stack) return <p className="text-sm text-text-subtle">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/stacks" className="text-xs text-text-subtle hover:text-text-muted">
          ← All stacks
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <span className="text-3xl">{stack.emoji}</span>
          <h1 className="text-2xl font-semibold">{stack.name}</h1>
          <span className="badge bg-edge text-text-muted">{stack.difficulty}</span>
        </div>
        <p className="mt-2 text-text-subtle">{stack.summary}</p>
      </div>

      {stack.prerequisites.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-subtle">
            Prerequisites
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
            {stack.prerequisites.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recipe body */}
      <div className="card">
        {stack.blocks.map((b, i) =>
          b.type === "code" ? (
            <CodeBlock key={i} code={b.body} language={b.language} filename={b.filename} />
          ) : (
            <MarkdownLite key={i}>{b.body}</MarkdownLite>
          ),
        )}
      </div>

      {/* Professional use cases */}
      {stack.use_cases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            Professional use cases
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {stack.use_cases.map((u, i) => (
              <div key={i} className="card">
                <h3 className="font-medium text-accent">{u.title}</h3>
                <p className="mt-1 text-sm text-text-subtle">{u.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
