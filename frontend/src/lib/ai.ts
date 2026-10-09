// Client helpers for the advanced AI features (Phase 2): a streaming tutor over
// Server-Sent Events, plus typed shapes for review / quiz / recommendations.
// Non-streaming calls live on `api` (lib/api.ts); streaming needs the raw body
// reader, so it lives here.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TutorStreamRequest {
  lab_id: string;
  step_id: string;
  messages: ChatMessage[];
  submission?: unknown;
  last_result?: unknown;
  hint_level?: number;
}

export interface ReviewIssue {
  severity: "critical" | "warning" | "nit" | string;
  message: string;
}

export interface CodeReview {
  verdict: string;
  strengths: string[];
  issues: ReviewIssue[];
  suggestion: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
}

export interface Quiz {
  title: string;
  questions: QuizQuestion[];
}

export interface Recommendation {
  lab_id: string;
  title: string;
  difficulty: string;
  reason: string;
}

export interface LearningPath {
  summary: string;
  recommendations: Recommendation[];
}

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("dqai.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Stream a tutor reply. Calls `onChunk` for each token delta. Returns the full
 * text when the stream completes. Throws on a server-reported error.
 */
export async function streamTutor(
  body: TutorStreamRequest,
  onChunk: (delta: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/ai/tutor/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `Tutor request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt: { text?: string; done?: boolean; error?: string };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(evt.error);
      if (evt.text) {
        full += evt.text;
        onChunk(evt.text, full);
      }
    }
  }
  return full;
}
