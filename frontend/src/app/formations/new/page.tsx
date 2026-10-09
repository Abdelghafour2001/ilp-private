"use client";

import Link from "next/link";
import FormationBuilder from "@/components/FormationBuilder";

export default function NewFormation() {
  return (
    <div className="space-y-4">
      <Link href="/formations" className="text-xs text-text-subtle hover:text-text">
        ← Trainings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Create a training</h1>
        <p className="mt-1 text-sm text-text-muted">
          Three steps: the basics, then the curriculum (modules → lessons mixing articles, videos,
          quizzes and hands-on AI practice), then the people who should take it.
        </p>
      </div>
      <FormationBuilder />
    </div>
  );
}
