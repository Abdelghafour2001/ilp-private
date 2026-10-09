"use client";

import Link from "next/link";
import CourseBuilder from "@/components/CourseBuilder";

export default function NewCourse() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/courses" className="text-xs text-text-subtle hover:text-text-muted">
          ← All courses
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Create a course</h1>
        <p className="mt-1 text-sm text-text-subtle">
          Mix articles, videos, hands-on labs, and quizzes into a learning path.
        </p>
      </div>
      <CourseBuilder />
    </div>
  );
}
