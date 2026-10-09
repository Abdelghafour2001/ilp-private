"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";
import Icon from "@/components/Icon";
import CreateLayout from "@/components/form/CreateLayout";
import Field, { FormSection } from "@/components/form/Field";
import MarkdownField from "@/components/form/MarkdownField";
import TagInput from "@/components/form/TagInput";
import { usePopularTags } from "@/components/form/usePopularTags";

const THEMES = ["General", "GenAI", "Data quality", "Automation", "Customer", "Sustainability"];

export default function NewChallenge() {
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  const [f, setF] = useState({ title: "", summary: "", brief_md: "", theme: "General", prize: "", deadline: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popular = usePopularTags(() => api.listChallenges());

  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  async function submit() {
    const me = getStoredLearner();
    if (!me) return setError(t("form.hub.signIn"));
    setBusy(true);
    setError(null);
    try {
      const c = await api.createChallenge({
        title: f.title.trim(),
        summary: f.summary.trim(),
        brief_md: f.brief_md,
        theme: f.theme.trim() || "General",
        prize: f.prize.trim() || null,
        deadline: f.deadline || null,
        tags,
        learner_id: me.id,
        author: me.handle,
      });
      router.push(`/challenges/${c.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = f.deadline ? Math.ceil((new Date(f.deadline).getTime() - Date.now()) / 86_400_000) : null;

  const preview = (
    <article className="panel overflow-hidden">
      <div className="relative h-24 overflow-hidden border-b border-border bg-surface-2">
        <span
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(rgb(var(--chart-3)) 1px, transparent 1.2px)",
            backgroundSize: "14px 14px",
            maskImage: "linear-gradient(225deg, black, transparent 70%)",
            WebkitMaskImage: "linear-gradient(225deg, black, transparent 70%)",
          }}
        />
        <span className="absolute bottom-3 left-4 grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-text-muted shadow-sm">
          <Icon name="challenges" size={18} />
        </span>
        <span className="absolute right-3 top-3 badge bg-surface text-text-muted shadow-xs">{f.theme || "General"}</span>
      </div>
      <div className="p-4">
        <p className="flex items-center gap-1.5 text-xs text-text-subtle">
          <span className="h-1.5 w-1.5 rounded-full bg-good" /> {t("chal.new.open")}
          {daysLeft != null && daysLeft >= 0 && (
            <>
              <span>·</span>
              <span className="tnum">{t("chal.new.daysLeft", { n: daysLeft })}</span>
            </>
          )}
        </p>
        <h3 className={`mt-1.5 font-semibold leading-snug ${f.title ? "text-text" : "text-text-subtle"}`}>
          {f.title || t("chal.new.titlePh")}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-text-muted">{f.summary || t("chal.new.summaryPh")}</p>
        {f.prize && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1 text-xs font-medium text-warn">
            <Icon name="trophy" size={12} /> {f.prize}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );

  return (
    <CreateLayout
      back={{ href: "/challenges", label: t("chal.new.back") }}
      title={t("chal.new.title")}
      lede={t("chal.new.lede")}
      preview={preview}
      checklist={[
        { label: t("chal.new.ckTitle"), done: f.title.trim().length >= 4, required: true },
        { label: t("chal.new.ckSummary"), done: f.summary.trim().length >= 10 },
        { label: t("chal.new.ckBrief"), done: f.brief_md.trim().length >= 40 },
        { label: t("chal.new.ckDeadline"), done: !!f.deadline },
        { label: t("chal.new.ckTags"), done: tags.length > 0 },
      ]}
      error={error}
      submitLabel={t("chal.new.submit")}
      busyLabel={t("chal.new.busy")}
      busy={busy}
      onSubmit={submit}
    >
      <FormSection step={1} title={t("chal.new.s1")} lede={t("chal.new.s1Lede")}>
        <Field id="c-title" label={t("chal.new.fTitle")} count={f.title.length} max={80}>
          <input
            id="c-title"
            name="title"
            className="input py-2.5 text-base font-medium"
            autoComplete="off"
            autoFocus
            placeholder={t("chal.new.titlePh")}
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <Field id="c-summary" label={t("chal.new.fSummary")} hint={t("chal.new.fSummaryHint")} count={f.summary.length} max={140}>
          <input
            id="c-summary"
            name="summary"
            className="input"
            autoComplete="off"
            placeholder={t("chal.new.summaryPh")}
            value={f.summary}
            onChange={(e) => set("summary", e.target.value)}
          />
        </Field>
        <Field id="c-brief" label={t("chal.new.fBrief")} hint={t("chal.new.fBriefHint")}>
          <MarkdownField
            id="c-brief"
            value={f.brief_md}
            onChange={(v) => set("brief_md", v)}
            rows={9}
            describedBy="c-brief-hint"
            placeholder={t("chal.new.briefPh")}
          />
        </Field>
      </FormSection>

      <FormSection step={2} title={t("chal.new.s2")} lede={t("chal.new.s2Lede")}>
        <Field id="c-theme" label={t("chal.new.fTheme")}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("chal.new.fTheme")}>
            {THEMES.map((th) => (
              <button
                key={th}
                type="button"
                role="radio"
                aria-checked={f.theme === th}
                onClick={() => set("theme", th)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  f.theme === th ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                }`}
              >
                {th}
              </button>
            ))}
            <input
              id="c-theme"
              className="input h-[2.125rem] w-40 py-1 text-sm"
              aria-label={t("chal.new.otherTheme")}
              placeholder={t("chal.new.otherTheme")}
              value={THEMES.includes(f.theme) ? "" : f.theme}
              onChange={(e) => set("theme", e.target.value)}
            />
          </div>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="c-prize" label={t("chal.new.fPrize")} optional hint={t("chal.new.fPrizeHint")}>
            <input id="c-prize" name="prize" className="input" autoComplete="off" placeholder={t("chal.new.prizePh")} value={f.prize} onChange={(e) => set("prize", e.target.value)} />
          </Field>
          <Field
            id="c-deadline"
            label={t("chal.new.fDeadline")}
            optional
            hint={f.deadline ? fmt.date(f.deadline, { weekday: "long", day: "numeric", month: "long" }) : t("chal.new.fDeadlineHint")}
          >
            <input id="c-deadline" name="deadline" type="date" min={today} className="input" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </Field>
        </div>
        <Field id="c-tags" label={t("chal.new.fTags")} optional>
          <TagInput id="c-tags" value={tags} onChange={setTags} suggestions={popular} />
        </Field>
      </FormSection>
    </CreateLayout>
  );
}
