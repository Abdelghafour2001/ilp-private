"use client";

import CourseBuilder from "@/components/CourseBuilder";
import { useT } from "@/lib/i18n";

export default function NewCourse() {
  const t = useT();
  return (
    <CourseBuilder
      back={{ href: "/courses", label: t("course.back") }}
      title={t("cb.newTitle")}
      lede={t("cb.newLede")}
    />
  );
}
