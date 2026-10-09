"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type CheckKind, type LabDefinition } from "@/lib/api";

interface EditStep {
  id: string;
  type: "concept" | "exercise" | "challenge";
  title: string;
  body_md: string;
  xp: string;
  builderMode: "none" | "check" | "sql" | "choice";
  builderTable: string;
  builderHintColumn: string;
  builderOptions: string; // newline-separated
  graderType: "" | "check_failing_count" | "sql_scalar" | "choice";
  requireKind: string;
  requireColumn: string;
  expect: string;
  expectMin: string;
  expectMax: string;
  answer: string;
}

const BLANK_STEP = (): EditStep => ({
  id: "",
  type: "concept",
  title: "",
  body_md: "",
  xp: "0",
  builderMode: "none",
  builderTable: "",
  builderHintColumn: "",
  builderOptions: "",
  graderType: "",
  requireKind: "",
  requireColumn: "",
  expect: "",
  expectMin: "",
  expectMax: "",
  answer: "",
});

function fromDefinition(def: LabDefinition): { meta: Meta; steps: EditStep[] } {
  const meta: Meta = {
    id: def.id ?? "",
    title: def.title ?? "",
    track: def.track ?? "Fundamentals",
    difficulty: def.difficulty ?? "beginner",
    summary: def.summary ?? "",
    tags: (def.tags ?? []).join(", "),
    schema: def.dataset?.schema ?? "public",
    table: def.dataset?.table ?? "",
  };
  const steps = (def.steps ?? []).map((raw) => {
    const s = raw as Record<string, any>;
    const b = (s.builder ?? {}) as Record<string, any>;
    const g = (s.grader ?? {}) as Record<string, any>;
    const num = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    return {
      ...BLANK_STEP(),
      id: s.id ?? "",
      type: s.type ?? "concept",
      title: s.title ?? "",
      body_md: s.body_md ?? "",
      xp: num(s.xp ?? 0),
      builderMode: b.mode ?? "none",
      builderTable: b.table ?? "",
      builderHintColumn: b.hint_column ?? "",
      builderOptions: (b.options ?? []).join("\n"),
      graderType: g.type ?? "",
      requireKind: g.require_kind ?? "",
      requireColumn: g.require_column ?? "",
      expect: num(g.expect),
      expectMin: num(g.expect_min),
      expectMax: num(g.expect_max),
      answer: g.answer ?? "",
    } as EditStep;
  });
  return { meta, steps: steps.length ? steps : [BLANK_STEP()] };
}

interface Meta {
  id: string;
  title: string;
  track: string;
  difficulty: string;
  summary: string;
  tags: string;
  schema: string;
  table: string;
}

const numOrStr = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && !Number.isNaN(n) ? n : v;
};

function buildDefinition(meta: Meta, steps: EditStep[]): LabDefinition {
  return {
    id: meta.id.trim(),
    title: meta.title.trim(),
    track: meta.track.trim(),
    difficulty: meta.difficulty,
    summary: meta.summary.trim(),
    tags: meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
    dataset: { schema: meta.schema.trim() || "public", table: meta.table.trim() },
    steps: steps.map((s) => {
      const step: Record<string, unknown> = {
        id: s.id.trim(),
        type: s.type,
        title: s.title.trim(),
        body_md: s.body_md,
        xp: Number(s.xp) || 0,
      };
      if (s.type !== "concept") {
        const builder: Record<string, unknown> = { mode: s.builderMode };
        if (s.builderMode === "check") {
          if (s.builderTable) builder.table = s.builderTable.trim();
          if (s.builderHintColumn) builder.hint_column = s.builderHintColumn.trim();
        }
        if (s.builderMode === "choice") {
          builder.options = s.builderOptions.split("\n").map((o) => o.trim()).filter(Boolean);
        }
        step.builder = builder;

        if (s.graderType) {
          const grader: Record<string, unknown> = { type: s.graderType };
          if (s.graderType === "check_failing_count") {
            if (s.requireKind) grader.require_kind = s.requireKind;
            if (s.requireColumn) grader.require_column = s.requireColumn.trim();
          }
          if (s.graderType === "choice") {
            grader.answer = s.answer.trim();
          } else {
            if (s.expect !== "") grader.expect = numOrStr(s.expect);
            if (s.expectMin !== "") grader.expect_min = Number(s.expectMin);
            if (s.expectMax !== "") grader.expect_max = Number(s.expectMax);
          }
          step.grader = grader;
        }
      }
      return step;
    }),
  };
}

export default function LabEditor({
  initial,
  lockId = false,
}: {
  initial?: { definition: LabDefinition; published: boolean };
  lockId?: boolean;
}) {
  const router = useRouter();
  const seed = initial ? fromDefinition(initial.definition) : { meta: blankMeta(), steps: [BLANK_STEP()] };
  const [meta, setMeta] = useState<Meta>(seed.meta);
  const [steps, setSteps] = useState<EditStep[]>(seed.steps);
  const [published, setPublished] = useState(initial?.published ?? true);
  const [kinds, setKinds] = useState<CheckKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    api.checkKinds().then(setKinds).catch(() => {});
  }, []);

  function setStep(i: number, patch: Partial<EditStep>) {
    setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((cur) => [...cur, BLANK_STEP()]);
  }
  function removeStep(i: number) {
    setSteps((cur) => cur.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setSteps((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function validate() {
    setError(null);
    setOk(null);
    try {
      await api.adminValidate(buildDefinition(meta, steps));
      setOk("✓ Definition is valid.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const def = buildDefinition(meta, steps);
      if (lockId && initial) {
        await api.adminUpdateLab(meta.id, def, published);
      } else {
        await api.adminCreateLab(def, published);
      }
      router.push("/admin/labs");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Metadata */}
      <div className="card space-y-3">
        <h3 className="font-medium">Lab details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="id (slug)">
            <input
              className="input"
              value={meta.id}
              disabled={lockId}
              onChange={(e) => setMeta({ ...meta, id: e.target.value })}
            />
          </Field>
          <Field label="title">
            <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <Field label="track">
            <input className="input" value={meta.track} onChange={(e) => setMeta({ ...meta, track: e.target.value })} />
          </Field>
          <Field label="difficulty">
            <select className="input" value={meta.difficulty} onChange={(e) => setMeta({ ...meta, difficulty: e.target.value })}>
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
            </select>
          </Field>
          <Field label="dataset schema">
            <input className="input" value={meta.schema} onChange={(e) => setMeta({ ...meta, schema: e.target.value })} />
          </Field>
          <Field label="dataset table">
            <input className="input" value={meta.table} onChange={(e) => setMeta({ ...meta, table: e.target.value })} />
          </Field>
        </div>
        <Field label="summary">
          <input className="input" value={meta.summary} onChange={(e) => setMeta({ ...meta, summary: e.target.value })} />
        </Field>
        <Field label="tags (comma-separated)">
          <input className="input" value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published (visible to learners)
        </label>
      </div>

      {/* Steps */}
      {steps.map((s, i) => (
        <div key={i} className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Step {i + 1}</h3>
            <div className="flex gap-2 text-xs">
              <button className="text-text-subtle hover:text-text" onClick={() => move(i, -1)}>↑</button>
              <button className="text-text-subtle hover:text-text" onClick={() => move(i, 1)}>↓</button>
              <button className="text-bad hover:underline" onClick={() => removeStep(i)}>remove</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="id">
              <input className="input" value={s.id} onChange={(e) => setStep(i, { id: e.target.value })} />
            </Field>
            <Field label="type">
              <select className="input" value={s.type} onChange={(e) => setStep(i, { type: e.target.value as EditStep["type"] })}>
                <option value="concept">concept</option>
                <option value="exercise">exercise</option>
                <option value="challenge">challenge</option>
              </select>
            </Field>
            <Field label="xp">
              <input className="input" type="number" value={s.xp} onChange={(e) => setStep(i, { xp: e.target.value })} />
            </Field>
          </div>
          <Field label="title">
            <input className="input" value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
          </Field>
          <Field label="body (markdown)">
            <textarea className="input h-28 font-mono text-xs" value={s.body_md} onChange={(e) => setStep(i, { body_md: e.target.value })} />
          </Field>

          {s.type !== "concept" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="builder mode">
                  <select className="input" value={s.builderMode} onChange={(e) => setStep(i, { builderMode: e.target.value as EditStep["builderMode"] })}>
                    <option value="none">none</option>
                    <option value="choice">choice</option>
                  </select>
                </Field>
                {s.builderMode === "check" && (
                  <>
                    <Field label="table">
                      <input className="input" value={s.builderTable} onChange={(e) => setStep(i, { builderTable: e.target.value })} placeholder={meta.table} />
                    </Field>
                    <Field label="hint column">
                      <input className="input" value={s.builderHintColumn} onChange={(e) => setStep(i, { builderHintColumn: e.target.value })} />
                    </Field>
                  </>
                )}
              </div>
              {s.builderMode === "choice" && (
                <Field label="options (one per line)">
                  <textarea className="input h-20 font-mono text-xs" value={s.builderOptions} onChange={(e) => setStep(i, { builderOptions: e.target.value })} />
                </Field>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="grader type">
                  <select className="input" value={s.graderType} onChange={(e) => setStep(i, { graderType: e.target.value as EditStep["graderType"] })}>
                    <option value="">none</option>
                    <option value="choice">choice</option>
                  </select>
                </Field>
                {s.graderType === "check_failing_count" && (
                  <>
                    <Field label="require kind">
                      <select className="input" value={s.requireKind} onChange={(e) => setStep(i, { requireKind: e.target.value })}>
                        <option value="">(any)</option>
                        {kinds.map((k) => (
                          <option key={k.name} value={k.name}>{k.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="require column">
                      <input className="input" value={s.requireColumn} onChange={(e) => setStep(i, { requireColumn: e.target.value })} />
                    </Field>
                  </>
                )}
              </div>

              {(s.graderType === "check_failing_count" || s.graderType === "sql_scalar") && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="expect (exact)">
                    <input className="input" value={s.expect} onChange={(e) => setStep(i, { expect: e.target.value })} />
                  </Field>
                  <Field label="expect_min">
                    <input className="input" value={s.expectMin} onChange={(e) => setStep(i, { expectMin: e.target.value })} />
                  </Field>
                  <Field label="expect_max">
                    <input className="input" value={s.expectMax} onChange={(e) => setStep(i, { expectMax: e.target.value })} />
                  </Field>
                </div>
              )}
              {s.graderType === "choice" && (
                <Field label="correct answer">
                  <input className="input" value={s.answer} onChange={(e) => setStep(i, { answer: e.target.value })} />
                </Field>
              )}
            </>
          )}
        </div>
      ))}

      <button className="btn-ghost" onClick={addStep}>
        + Add step
      </button>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {ok && <div className="card border-good/40 text-sm text-good">{ok}</div>}

      <div className="flex gap-3">
        <button className="btn-ghost" onClick={validate}>
          Validate
        </button>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save lab"}
        </button>
      </div>
    </div>
  );
}

function blankMeta(): Meta {
  return { id: "", title: "", track: "Fundamentals", difficulty: "beginner", summary: "", tags: "", schema: "public", table: "customers" };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-text-subtle">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
