"use client";

import { use, useEffect, useState } from "react";
import { api, type Course } from "@/lib/api";
import CourseBuilder from "@/components/CourseBuilder";
import { useT } from "@/lib/i18n";

export default function EditCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCourse(Number(id)).then(setCourse).catch((e) => setError(String(e)));
  }, [id]);

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!course)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-9 w-64 skeleton" />
        <div className="h-96 skeleton rounded-2xl" />
      </div>
    );
  return (
    <CourseBuilder
      initial={course}
      back={{ href: `/courses/${id}`, label: t("cb.backToCourse") }}
      title={t("cb.editTitle")}
    />
  );
}
