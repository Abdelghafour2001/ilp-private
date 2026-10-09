"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import MarkdownLite from "@/components/MarkdownLite";
import { api } from "@/lib/api";
import { streamTutor, type ChatMessage, type CodeReview } from "@/lib/ai";

type Item =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | { kind: "review"; data: CodeReview };

const SEVERITY: Record<string, string> = {
  critical: "badge-bad",
  warning: "badge-warn",
  nit: "badge-accent",
};

export default function TutorChat({
  labId,
  stepId,
  builderMode,
  task,
  dataset,
  submission,
  lastResult,
  reviewable,
}: {
  labId: string;
  stepId: string;
  builderMode: string;
  task: string;
  dataset: string;
  submission: Record<string, unknown>;
  lastResult: unknown;
  reviewable?: { language: string; code: string } | null;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [hintLevel, setHintLevel] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset the conversation when the learner moves to a new step.
  useEffect(() => {
    setItems([]);
    setStreaming("");
    setHintLevel(1);
    setError(null);
  }, [stepId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, streaming]);

  function history(): ChatMessage[] {
    return items
      .filter((i): i is Extract<Item, { kind: "msg" }> => i.kind === "msg")
      .map((i) => ({ role: i.role, content: i.content }));
  }

  async function send(userText: string, level: number) {
    if (busy) return;
    setError(null);
    setBusy(true);
    const nextHistory: ChatMessage[] = [...history(), { role: "user", content: userText }];
    setItems((prev) => [...prev, { kind: "msg", role: "user", content: userText }]);
    setStreaming("");
    try {
      const full = await streamTutor(
        {
          lab_id: labId,
          step_id: stepId,
          messages: nextHistory,
          submission,
          last_result: lastResult,
          hint_level: level,
        },
        (_delta, soFar) => setStreaming(soFar),
      );
      setItems((prev) => [...prev, { kind: "msg", role: "assistant", content: full }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }

  function askHint() {
    const prompts = [
      "Can you give me a gentle hint to get started?",
      "I'm still stuck — can you be more specific?",
      "Walk me through the approach, please.",
    ];
    const level = Math.min(hintLevel, 3);
    send(prompts[level - 1], level);
    setHintLevel((l) => Math.min(l + 1, 3));
  }

  function submitInput() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text, 1);
  }

  async function reviewCode() {
    if (!reviewable || busy) return;
    if (!reviewable.code.trim()) {
      setError("Write some code first, then ask for a review.");
      return;
    }
    setError(null);
    setBusy(true);
    setItems((prev) => [
      ...prev,
      { kind: "msg", role: "user", content: "Please review my code." },
    ]);
    try {
      const data = await api.reviewCode({
        language: reviewable.language,
        code: reviewable.code,
        task,
        dataset,
      });
      setItems((prev) => [...prev, { kind: "review", data }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hintLabels = ["Hint", "More help", "Walk me through"];
  const empty = items.length === 0 && !streaming;

  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent-text">
            <Icon name="sparkles" size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">AI Tutor</p>
            <p className="mt-0.5 text-[11px] text-text-subtle">Guides you — never spoils the answer</p>
          </div>
        </div>
        {items.length > 0 && (
          <button
            className="text-xs text-text-subtle hover:text-text"
            onClick={() => {
              setItems([]);
              setHintLevel(1);
              setError(null);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="max-h-80 min-h-[7rem] space-y-3 overflow-y-auto p-4">
        {empty && (
          <div className="py-6 text-center">
            <p className="text-sm text-text-muted">
              Stuck or curious? Ask anything about this step — or get a nudge.
            </p>
          </div>
        )}

        {items.map((it, i) =>
          it.kind === "msg" ? (
            <div
              key={i}
              className={it.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={[
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                  it.role === "user"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-2 text-text",
                ].join(" ")}
              >
                {it.role === "assistant" ? (
                  <div className="prose-tutor"><MarkdownLite>{it.content}</MarkdownLite></div>
                ) : (
                  it.content
                )}
              </div>
            </div>
          ) : (
            <ReviewCard key={i} review={it.data} />
          ),
        )}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-surface-2 px-3.5 py-2 text-sm text-text">
              <div className="prose-tutor"><MarkdownLite>{streaming}</MarkdownLite></div>
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
            </div>
          </div>
        )}

        {busy && !streaming && (
          <div className="flex items-center gap-2 text-xs text-text-subtle">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Thinking…
          </div>
        )}
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs text-bad">{error}</p>
      )}

      {/* quick actions */}
      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2.5">
        <button className="btn-soft btn-sm" onClick={askHint} disabled={busy}>
          <Icon name="bolt" size={13} /> {hintLabels[Math.min(hintLevel, 3) - 1]}
        </button>
        {reviewable && (builderMode === "code" || builderMode === "sql") && (
          <button className="btn-ghost btn-sm" onClick={reviewCode} disabled={busy}>
            <Icon name="check" size={13} /> Review my {builderMode === "sql" ? "SQL" : "code"}
          </button>
        )}
        <button
          className="btn-ghost btn-sm"
          onClick={() => send("Explain the key concept behind this step, simply.", 1)}
          disabled={busy}
        >
          <Icon name="book" size={13} /> Explain concept
        </button>
      </div>

      {/* input */}
      <div className="flex items-center gap-2 border-t border-border p-3">
        <input
          className="input"
          placeholder="Ask the tutor…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitInput()}
          disabled={busy}
        />
        <button className="btn shrink-0" onClick={submitInput} disabled={busy || !input.trim()}>
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: CodeReview }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-3.5 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="sparkles" size={15} className="text-accent-text" />
        <span className="font-semibold">Code review</span>
      </div>
      <p className="text-text">{review.verdict}</p>
      {review.strengths.length > 0 && (
        <div className="mt-2.5">
          <p className="eyebrow mb-1">Strengths</p>
          <ul className="space-y-1">
            {review.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-text-muted">
                <Icon name="check" size={14} className="mt-0.5 shrink-0 text-good" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.issues.length > 0 && (
        <div className="mt-2.5">
          <p className="eyebrow mb-1">To improve</p>
          <ul className="space-y-1.5">
            {review.issues.map((iss, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`badge ${SEVERITY[iss.severity] ?? "badge-accent"} shrink-0`}>
                  {iss.severity}
                </span>
                <span className="text-text-muted">{iss.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.suggestion && (
        <p className="mt-2.5 rounded-lg bg-accent/10 p-2.5 text-text-muted">
          <span className="font-medium text-accent-text">Next: </span>
          {review.suggestion}
        </p>
      )}
    </div>
  );
}
