"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  type GradeResult,
  type Lab,
  type LabStep,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";
import CodeLab from "@/components/CodeLab";
import TutorChat from "@/components/TutorChat";
import AiQuiz from "@/components/AiQuiz";
import Icon from "@/components/Icon";

export default function LabRunner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lab, setLab] = useState<Lab | null>(null);
  const [idx, setIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  useEffect(() => {
    api.getLab(id).then(setLab).catch((e) => setError(String(e)));
    const learner = getStoredLearner();
    if (learner) {
      api.learnerProfile(learner.id).then((p) => {
        setCompleted(
          new Set(
            p.completed_steps
              .filter((s) => s.startsWith(`${id}:`))
              .map((s) => s.split(":")[1]),
          ),
        );
      });
    }
  }, [id]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!lab) return <p className="text-sm text-text-muted">Loading…</p>;

  const step = lab.steps[idx];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/labs" className="text-xs text-text-subtle hover:text-text-muted">
            ← All labs
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{lab.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setQuizOpen(true)}>
            <Icon name="sparkles" size={14} /> Quiz me
          </button>
        </div>
      </div>

      {quizOpen && <AiQuiz labId={lab.id} onClose={() => setQuizOpen(false)} />}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Stepper */}
        <nav className="space-y-1">
          {lab.steps.map((s, i) => {
            const done = completed.has(s.id);
            const active = i === idx;
            return (
              <button
                key={s.id}
                onClick={() => setIdx(i)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  active ? "border-accent bg-accent/10" : "border-edge hover:bg-edge"
                }`}
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${
                    done ? "bg-good text-ink" : "border border-edge text-text-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </button>
            );
          })}
        </nav>

        {/* Step content */}
        <StepPanel
          key={step.id}
          lab={lab}
          step={step}
          isLast={idx === lab.steps.length - 1}
          done={completed.has(step.id)}
          onPass={() => setCompleted((c) => new Set(c).add(step.id))}
          onNext={() => setIdx((i) => Math.min(i + 1, lab.steps.length - 1))}
        />
      </div>
    </div>
  );
}

function StepPanel({
  lab,
  step,
  isLast,
  done,
  onPass,
  onNext,
}: {
  lab: Lab;
  step: LabStep;
  isLast: boolean;
  done: boolean;
  onPass: () => void;
  onNext: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [codeText, setCodeText] = useState(step.builder.starter_code ?? "");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submission = useMemo(() => {
    if (step.builder.mode === "choice") return { answer: choice };
    if (step.builder.mode === "code") return { code: codeText };
    return {};
  }, [step.builder.mode, choice, codeText]);

  async function grade(sub: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const learner = getStoredLearner();
      const res = await api.gradeStep(lab.id, step.id, {
        learner_id: learner?.id ?? null,
        submission: sub,
      });
      setResult(res);
      if (res.passed) {
        onPass();
        if (res.awarded_xp > 0 || res.new_badges.length > 0) {
          window.dispatchEvent(new Event("dqai-learner-changed"));
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = () => grade(submission);

  const gradable = step.gradable;

  const reviewable =
    step.builder.mode === "code"
      ? { language: step.builder.language ?? "python", code: codeText }
      : null;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="mb-2 flex items-center gap-2">
          <span className="badge bg-edge text-text-muted">{step.type}</span>
          {step.xp > 0 && <span className="badge bg-accent/15 text-accent">⚡ {step.xp} XP</span>}
          {done && <span className="badge bg-good/15 text-good">✓ done</span>}
        </div>
        <h2 className="text-lg font-semibold">{step.title}</h2>
        <MarkdownLite>{step.body_md}</MarkdownLite>
      </div>

      {/* Interactive area */}
      {step.builder.mode === "choice" && (
        <div className="space-y-2">
          {step.builder.options.map((opt) => (
            <label
              key={opt}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                choice === opt ? "border-accent bg-accent/10" : "border-edge hover:bg-edge"
              }`}
            >
              <input
                type="radio"
                name="choice"
                value={opt}
                checked={choice === opt}
                onChange={(e) => setChoice(e.target.value)}
              />
              <span className="font-mono">{opt}</span>
            </label>
          ))}
        </div>
      )}
      {step.builder.mode === "code" && (
        <CodeLab
          language={step.builder.language ?? "python"}
          starterCode={step.builder.starter_code ?? ""}
          testCode={step.builder.test_code ?? ""}
          onCodeChange={setCodeText}
        />
      )}

      {error && <p className="text-sm text-bad">{error}</p>}

      {result && (
        <div className={`card ${result.passed ? "border-good/40" : "border-bad/40"}`}>
          <p className={`font-medium ${result.passed ? "text-good" : "text-bad"}`}>
            {result.passed ? "✓ " : "✗ "}
            {result.message}
          </p>
          {!result.passed && typeof result.detail?.output === "string" && result.detail.output && (
            <pre className="mt-2 overflow-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs text-text-muted">
              {result.detail.output}
            </pre>
          )}
          {result.passed && result.awarded_xp > 0 && (
            <p className="mt-1 text-sm text-accent">+{result.awarded_xp} XP earned!</p>
          )}
          {result.new_badges.length > 0 && (
            <p className="mt-1 text-sm text-warn">
              🏅 New badge{result.new_badges.length > 1 ? "s" : ""}: {result.new_badges.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {gradable ? (
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "Checking…" : "Submit answer"}
          </button>
        ) : (
          <span className="text-sm text-text-subtle">Read through, then continue.</span>
        )}
        {(result?.passed || !gradable) && !isLast && (
          <button className="btn-ghost" onClick={onNext}>
            Next step →
          </button>
        )}
        {(result?.passed || !gradable) && isLast && (
          <Link href="/labs" className="btn-ghost">
            🎉 Finish lab
          </Link>
        )}
      </div>

      {/* AI tutor — streaming, conversational, context-aware */}
      {gradable && (
        <TutorChat
          labId={lab.id}
          stepId={step.id}
          builderMode={step.builder.mode}
          task={`${step.title}\n\n${step.body_md}`}
          dataset={`${lab.dataset.schema}.${lab.dataset.table}`}
          submission={submission}
          lastResult={result}
          reviewable={reviewable}
        />
      )}
    </div>
  );
}
