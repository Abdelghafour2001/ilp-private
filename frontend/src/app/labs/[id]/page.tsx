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
import { useT } from "@/lib/i18n";

export default function LabRunner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const [lab, setLab] = useState<Lab | null>(null);
  const [idx, setIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  // Badge ids → names, so "New badge: bug_hunter" reads "Bug Hunter".
  const [badgeNames, setBadgeNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .badges()
      .then((bs) => setBadgeNames(Object.fromEntries(bs.map((b) => [b.id, `${b.emoji} ${b.name}`]))))
      .catch(() => {});
  }, []);

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

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!lab)
    return (
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]" aria-busy="true">
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 skeleton" />
          ))}
        </div>
        <div className="h-64 skeleton rounded-xl" />
      </div>
    );

  const step = lab.steps[idx];
  const gradableSteps = lab.steps.filter((s) => s.gradable);
  const doneCount = gradableSteps.filter((s) => completed.has(s.id)).length;
  const pct = gradableSteps.length ? Math.round((100 * doneCount) / gradableSteps.length) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-4">
        <Link href="/labs" className="group flex min-w-0 items-center gap-2 text-sm">
          <Icon name="arrow-right" size={14} className="rotate-180 text-text-subtle group-hover:text-text" />
          <Icon name="labs" size={16} className="text-accent-text" />
          <span className="truncate font-medium text-text group-hover:text-accent-text">{lab.title}</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-subtle tnum">{t("labs.steps", { done: doneCount, total: gradableSteps.length })}</span>
          <div
            className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={lab.title}
          >
            <div
              className={`h-full origin-left rounded-full transition-transform duration-500 ${pct === 100 ? "bg-good" : "bg-accent"}`}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setQuizOpen(true)}>
            <Icon name="sparkles" size={14} /> {t("lab.quizMe")}
          </button>
        </div>
      </div>

      {quizOpen && <AiQuiz labId={lab.id} onClose={() => setQuizOpen(false)} />}

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={t("lab.steps")} className="lg:sticky lg:top-24 lg:self-start">
          <ol>
            {lab.steps.map((s, i) => {
              const done = completed.has(s.id);
              const active = i === idx;
              return (
                <li key={s.id} className="relative">
                  {i < lab.steps.length - 1 && (
                    <span className={`absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px ${done ? "bg-good/40" : "bg-border"}`} aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => setIdx(i)}
                    aria-current={active ? "step" : undefined}
                    className={`relative flex w-full items-start gap-3 py-1.5 text-left text-sm transition-colors ${active ? "text-text" : "text-text-muted hover:text-text"}`}
                  >
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold tnum ${
                        done ? "border-good bg-good text-white" : active ? "border-accent bg-surface text-accent-text" : "border-border bg-bg text-text-subtle"
                      }`}
                    >
                      {done ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={`leading-snug ${active ? "font-semibold" : ""}`}>{s.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0">
          <StepPanel
            key={step.id}
            lab={lab}
            step={step}
            position={t("lab.stepOf", { n: idx + 1, total: lab.steps.length })}
            badgeNames={badgeNames}
            isLast={idx === lab.steps.length - 1}
            done={completed.has(step.id)}
            onPass={() => setCompleted((c) => new Set(c).add(step.id))}
            onNext={() => {
              setIdx((i) => Math.min(i + 1, lab.steps.length - 1));
              window.scrollTo({ top: 0 });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function StepPanel({
  lab,
  step,
  position,
  badgeNames,
  isLast,
  done,
  onPass,
  onNext,
}: {
  lab: Lab;
  step: LabStep;
  position: string;
  badgeNames: Record<string, string>;
  isLast: boolean;
  done: boolean;
  onPass: () => void;
  onNext: () => void;
}) {
  const t = useT();
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
      <header className="max-w-[72ch]">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-subtle">
          <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-medium capitalize text-accent-text">{step.type}</span>
          <span className="tnum">{position}</span>
          {step.xp > 0 && (
            <span className="inline-flex items-center gap-1 tnum">
              <Icon name="bolt" size={11} className="text-iris" /> {step.xp}&nbsp;XP
            </span>
          )}
          {done && (
            <span className="inline-flex items-center gap-1 text-good">
              <Icon name="check" size={12} /> {t("course.completed")}
            </span>
          )}
        </p>
        <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">{step.title}</h1>
        <div className="mt-4 [&_li]:text-[15px] [&_li]:leading-7 [&_p.my-2]:text-[15px] [&_p.my-2]:leading-7">
          <MarkdownLite>{step.body_md}</MarkdownLite>
        </div>
      </header>

      {/* Interactive area */}
      {step.builder.mode === "choice" && (
        <fieldset className="max-w-[72ch] space-y-2">
          <legend className="sr-only">{step.title}</legend>
          {step.builder.options.map((opt, i) => {
            const picked = choice === opt;
            return (
              <label
                key={opt}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                  picked ? "border-accent bg-accent/5" : "border-border hover:border-border-strong hover:bg-surface"
                }`}
              >
                <input type="radio" name="choice" value={opt} checked={picked} onChange={(e) => setChoice(e.target.value)} className="sr-only" />
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-xs font-semibold ${picked ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted"}`}
                  aria-hidden="true"
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="font-mono">{opt}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      {step.builder.mode === "code" && (
        <CodeLab
          language={step.builder.language ?? "python"}
          starterCode={step.builder.starter_code ?? ""}
          testCode={step.builder.test_code ?? ""}
          onCodeChange={setCodeText}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {result && (
        <div
          aria-live="polite"
          className={`animate-fade-in rounded-xl border p-4 ${result.passed ? "border-good/40 bg-good/5" : "border-bad/40 bg-bad/5"}`}
        >
          <p className={`flex items-center gap-2 font-medium ${result.passed ? "text-good" : "text-bad"}`}>
            <Icon name={result.passed ? "check" : "x"} size={16} strokeWidth={2.5} />
            {result.message}
          </p>
          {!result.passed && typeof result.detail?.output === "string" && result.detail.output && (
            <pre className="mt-2 overflow-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs text-text-muted">
              {result.detail.output}
            </pre>
          )}
          {result.passed && result.awarded_xp > 0 && (
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-iris">
              <Icon name="bolt" size={13} /> {t("lab.xpEarned", { xp: result.awarded_xp })}
            </p>
          )}
          {result.new_badges.length > 0 && (
            <p className="mt-1 flex items-center gap-1 text-sm font-medium text-warn">
              <Icon name="award" size={14} /> {t("lab.newBadges", { n: result.new_badges.length, names: result.new_badges.map((b) => badgeNames[b] ?? b).join(", ") })}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {gradable && result?.passed ? null : gradable ? (
          <button type="button" className="btn" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
            {busy ? t("lab.checking") : t("lab.submit")}
          </button>
        ) : (
          <span className="text-sm text-text-subtle">{t("lab.readThrough")}</span>
        )}
        {(result?.passed || !gradable) && !isLast && (
          <button type="button" className={result?.passed ? "btn" : "btn-ghost"} onClick={onNext}>
            {t("lab.next")} <Icon name="arrow-right" size={15} />
          </button>
        )}
        {(result?.passed || !gradable) && isLast && (
          <Link href="/labs" className="btn">
            <Icon name="check" size={15} /> {t("lab.finish")}
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
