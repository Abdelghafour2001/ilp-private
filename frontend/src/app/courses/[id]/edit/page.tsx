"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Course } from "@/lib/api";
import CourseBuilder from "@/components/CourseBuilder";

export default function EditCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCourse(Number(id)).then(setCourse).catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/courses/${id}`} className="text-xs text-text-subtle hover:text-text-muted">
          ← Back to course
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit course</h1>
      </div>
      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {course && <CourseBuilder initial={course} />}
    </div>
  );
}
