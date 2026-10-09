import type { FormationLessonType, TrainingFormat } from "@/lib/api";

/** Delivery format of a training — shown on the fiche and the catalog cards. */
export const FORMAT_META: Record<TrainingFormat, { icon: string; label: string; desc: string }> = {
  in_person: { icon: "🏢", label: "In person", desc: "On site, in a room with the trainer." },
  virtual: { icon: "💻", label: "Virtual", desc: "Live online sessions (Teams)." },
  hybrid: { icon: "🔀", label: "Hybrid", desc: "Mix of live sessions and self-paced work." },
  elearning: { icon: "▶️", label: "E-learning", desc: "Self-paced — follow it whenever you want." },
};

export const FORMATS = Object.keys(FORMAT_META) as TrainingFormat[];

/** Display metadata for every formation lesson type — drives the builder
 * palette, the curriculum outline, and the learn player. */
export const F_LESSON_META: Record<
  FormationLessonType,
  { icon: string; label: string; desc: string; kind: "theory" | "practice" | "check" }
> = {
  article: {
    icon: "📖",
    label: "Theory",
    desc: "A markdown article — concepts, examples, code blocks.",
    kind: "theory",
  },
  video: {
    icon: "🎬",
    label: "Video",
    desc: "An embedded YouTube/Vimeo video with optional notes.",
    kind: "theory",
  },
  lab: {
    icon: "🧪",
    label: "Hands-on lab",
    desc: "Link a graded platform lab (SQL, checks, or code).",
    kind: "practice",
  },
  quiz: {
    icon: "❓",
    label: "Quiz",
    desc: "Multiple-choice checkpoint with explanations.",
    kind: "check",
  },
  prompt_playground: {
    icon: "🛝",
    label: "Prompt playground",
    desc: "Trainees write prompts and run them live against the LLM.",
    kind: "practice",
  },
  external_course: {
    icon: "🎓",
    label: "Provider course",
    desc: "A Coursera (or other provider) course from the catalogue. It ticks off when the provider reports it finished — never by hand.",
    kind: "practice",
  },
  prompt_challenge: {
    icon: "🏆",
    label: "Prompt challenge",
    desc: "Graded: an AI examiner scores the trainee's prompt against your rubric.",
    kind: "practice",
  },
};

export const F_LESSON_TYPES = Object.keys(F_LESSON_META) as FormationLessonType[];

export const LEVEL_BADGE: Record<string, string> = {
  beginner: "bg-good/15 text-good",
  intermediate: "bg-warn/15 text-warn",
  advanced: "bg-bad/15 text-bad",
};

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
