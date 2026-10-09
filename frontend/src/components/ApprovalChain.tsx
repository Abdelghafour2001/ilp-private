"use client";

/**
 * The path a training request has to walk: N+1 manager, then BU head.
 *
 * Shown on the request itself rather than only on the stage in front of you,
 * because the most common complaint about approval workflows is not the wait —
 * it is not knowing who is sitting on it. A requester should be able to see
 * that their manager said yes and it is now with the BU head without asking
 * anyone.
 *
 * A stage with nobody appointed is drawn as blocked, not as waiting. Those two
 * look identical from the outside and are completely different problems: one
 * resolves itself, the other needs somebody to appoint a BU head.
 */

import type { ApprovalStep } from "@/lib/api";
import { useT } from "@/lib/i18n";

const TONE: Record<ApprovalStep["status"], string> = {
  approved: "border-good/40 bg-good/10 text-good",
  declined: "border-bad/40 bg-bad/10 text-bad",
  pending: "border-border bg-surface-2 text-text-muted",
  skipped: "border-border bg-surface-2 text-text-subtle line-through",
};

const MARK: Record<ApprovalStep["status"], string> = {
  approved: "✓",
  declined: "✕",
  pending: "•",
  skipped: "–",
};

export default function ApprovalChain({ steps }: { steps?: ApprovalStep[] }) {
  const t = useT();
  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
        {t("approvals.chain")}
      </span>
      {steps.map((step, index) => (
        <span key={step.position} className="flex items-center gap-1.5">
          {index > 0 && (
            <span aria-hidden className="text-text-subtle">
              →
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
              step.unassigned ? "border-warn/40 bg-warn/10 text-warn" : TONE[step.status]
            }`}
            title={step.note || undefined}
          >
            <span aria-hidden className="font-bold">
              {step.unassigned ? "!" : MARK[step.status]}
            </span>
            <span className="font-medium">
              {step.approver || t("approvals.step.unassigned")}
            </span>
            <span className="opacity-70">
              {t(`approvals.stage.${step.stage}`, step.stage_label)}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
