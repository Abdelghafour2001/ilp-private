"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { api } from "@/lib/api";
import type { Quiz } from "@/lib/ai";

/** A modal that generates an AI quiz for a lab/topic and lets the learner take it. */
export default function AiQuiz({
  labId,
  topic,
  onClose,
}: {
  labId?: string;
  topic?: string;
  onClose: () => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .quiz({ lab_id: labId, topic, n: 5 })
      .then((q) => alive && setQuiz(q))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [labId, topic]);

  const score = quiz
    ? quiz.questions.reduce((n, q, i) => n + (answers[i] === q.answer_index ? 1 : 0), 0)
    : 0;
  const allAnswered = quiz ? Object.keys(answers).length === quiz.questions.length : false;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 p-4 pt-[8vh] backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Icon name="sparkles" size={18} className="text-accent-text" />
            <h2 className="font-semibold">{quiz?.title ?? "Knowledge check"}</h2>
          </div>
          <button className="btn-icon h-8 w-8" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
              {error}
            </div>
          )}

          {!quiz && !error && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Generating your quiz…
              </div>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-3/4 skeleton" />
                  <div className="h-9 w-full skeleton" />
                  <div className="h-9 w-full skeleton" />
                </div>
              ))}
            </div>
          )}

          {quiz && (
            <div className="space-y-6">
              {quiz.questions.map((q, qi) => {
                const chosen = answers[qi];
                return (
                  <div key={qi}>
                    <p className="mb-2.5 font-medium">
                      <span className="mr-1.5 text-text-subtle">{qi + 1}.</span>
                      {q.question}
                    </p>
                    <div className="space-y-2">
                      {q.options.map((opt, oi) => {
                        const isChosen = chosen === oi;
                        const isCorrect = oi === q.answer_index;
                        let cls = "border-border hover:bg-surface-2";
                        if (submitted) {
                          if (isCorrect) cls = "border-good/50 bg-good/10";
                          else if (isChosen) cls = "border-bad/50 bg-bad/10";
                          else cls = "border-border opacity-70";
                        } else if (isChosen) {
                          cls = "border-accent bg-accent/10";
                        }
                        return (
                          <button
                            key={oi}
                            disabled={submitted}
                            onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${cls}`}
                          >
                            <span
                              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium ${
                                isChosen || (submitted && isCorrect)
                                  ? "border-transparent bg-accent text-accent-fg"
                                  : "border-border-strong text-text-subtle"
                              }`}
                            >
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <span className="flex-1">{opt}</span>
                            {submitted && isCorrect && (
                              <Icon name="check" size={15} className="text-good" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {submitted && (
                      <p className="mt-2 rounded-lg bg-surface-2 p-2.5 text-xs text-text-muted">
                        {q.explanation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {quiz && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3.5">
            {submitted ? (
              <>
                <p className="text-sm font-medium">
                  Score:{" "}
                  <span className="font-mono tnum text-accent-text">
                    {score}/{quiz.questions.length}
                  </span>
                </p>
                <button className="btn-ghost" onClick={onClose}>
                  Done
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-text-subtle">
                  {Object.keys(answers).length}/{quiz.questions.length} answered
                </p>
                <button className="btn" disabled={!allAnswered} onClick={() => setSubmitted(true)}>
                  Submit quiz
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
