"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ASSET_KINDS, kindMeta } from "@/lib/assetKinds";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import Icon from "@/components/Icon";
import CreateLayout from "@/components/form/CreateLayout";
import Field, { FormSection } from "@/components/form/Field";
import MarkdownField from "@/components/form/MarkdownField";
import TagInput from "@/components/form/TagInput";
import { usePopularTags } from "@/components/form/usePopularTags";

export default function NewAsset() {
  const router = useRouter();
  const t = useT();
  const me = getStoredLearner();
  const [form, setForm] = useState({ title: "", kind: "idea", summary: "", body_md: "", code: "", link: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popular = usePopularTags(() => api.listAssets());

  const set = (k: keyof typeof form, v: string) => setForm((cur) => ({ ...cur, [k]: v }));
  const linkOk = !form.link || /^https?:\/\/\S+\.\S+/.test(form.link);
  const kind = kindMeta(form.kind);

  async function submit() {
    if (!me) return setError(t("form.hub.signIn"));
    setBusy(true);
    setError(null);
    try {
      const asset = await api.createAsset({
        title: form.title.trim(),
        kind: form.kind,
        summary: form.summary.trim(),
        body_md: form.body_md,
        code: form.code || null,
        link: form.link.trim() || null,
        tags,
        learner_id: me.id,
        author: me.handle,
      });
      router.push(`/assets/${asset.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const preview = (
    <article className="panel p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-xl">{kind.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-subtle">
            {t(`asset.kind.${form.kind}`, kind.label)} · {t("common.by")} {me?.handle}
          </p>
          <h3 className={`mt-0.5 font-semibold leading-snug ${form.title ? "text-text" : "text-text-subtle"}`}>
            {form.title || t("asset.new.titlePh")}
          </h3>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-text-muted">{form.summary || t("asset.new.summaryPh")}</p>
      {form.code && (
        <pre className="mt-3 max-h-24 overflow-hidden rounded-lg border border-border bg-bg p-2.5 font-mono text-[11px] leading-relaxed text-text-muted">
          {form.code.split("\n").slice(0, 5).join("\n")}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {form.link && linkOk && (
          <span className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent-text">
            <Icon name="external" size={11} /> {safeHost(form.link)}
          </span>
        )}
        {tags.map((tag) => (
          <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{tag}</span>
        ))}
      </div>
    </article>
  );

  return (
    <CreateLayout
      back={{ href: "/assets", label: t("asset.new.back") }}
      title={t("asset.new.title")}
      lede={t("asset.new.lede")}
      preview={preview}
      checklist={[
        { label: t("asset.new.ckTitle"), done: form.title.trim().length >= 3, required: true },
        { label: t("asset.new.ckSummary"), done: form.summary.trim().length >= 10 },
        { label: t("asset.new.ckWhere"), done: (!!form.link && linkOk) || !!form.code.trim() || form.body_md.trim().length >= 40 },
        { label: t("asset.new.ckTags"), done: tags.length > 0 },
        ...(linkOk ? [] : [{ label: t("sess.new.ckValidUrl"), done: false, required: true }]),
      ]}
      error={error}
      submitLabel={t("asset.new.submit")}
      busyLabel={t("asset.new.busy")}
      busy={busy}
      onSubmit={submit}
    >
      <FormSection step={1} title={t("asset.new.s1")} lede={t("asset.new.s1Lede")}>
        <Field id="a-kind" label={t("asset.new.fKind")}>
          <div id="a-kind" role="radiogroup" aria-label={t("asset.new.fKind")} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ASSET_KINDS.map((k) => {
              const on = form.kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("kind", k.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-[border-color,background-color,transform] active:scale-[0.97] ${
                    on ? "border-accent bg-accent/5 text-accent-text ring-1 ring-accent/30" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                  }`}
                >
                  <span className={`text-2xl transition-transform ${on ? "scale-110" : ""}`} aria-hidden="true">{k.emoji}</span>
                  {t(`asset.kind.${k.id}`, k.label)}
                </button>
              );
            })}
          </div>
        </Field>
        <Field id="a-title" label={t("asset.new.fTitle")} count={form.title.length} max={80}>
          <input id="a-title" name="title" className="input py-2.5 text-base font-medium" autoComplete="off" autoFocus placeholder={t("asset.new.titlePh")} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field id="a-summary" label={t("asset.new.fSummary")} count={form.summary.length} max={140}>
          <input id="a-summary" name="summary" className="input" autoComplete="off" placeholder={t("asset.new.summaryPh")} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
        </Field>
      </FormSection>

      <FormSection step={2} title={t("asset.new.s2")} lede={t("asset.new.s2Lede")}>
        <Field id="a-link" label={t("asset.new.fLink")} optional error={linkOk ? null : t("sess.new.badUrl")} hint={t("asset.new.fLinkHint")}>
          <input
            id="a-link"
            name="link"
            type="url"
            inputMode="url"
            className={`input ${linkOk ? "" : "border-bad focus:border-bad focus:ring-bad/25"}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/…"
            aria-invalid={!linkOk}
            value={form.link}
            onChange={(e) => set("link", e.target.value)}
          />
        </Field>
        <Field id="a-body" label={t("asset.new.fBody")} optional hint={t("asset.new.fBodyHint")}>
          <MarkdownField id="a-body" value={form.body_md} onChange={(v) => set("body_md", v)} rows={7} describedBy="a-body-hint" />
        </Field>
        <Field id="a-code" label={t("asset.new.fCode")} optional>
          <textarea
            id="a-code"
            name="code"
            rows={6}
            spellCheck={false}
            className="input resize-y bg-bg font-mono text-xs leading-relaxed"
            placeholder="def check(df): …"
            value={form.code}
            onChange={(e) => set("code", e.target.value)}
          />
        </Field>
        <Field id="a-tags" label={t("asset.new.fTags")} optional>
          <TagInput id="a-tags" value={tags} onChange={setTags} suggestions={popular} />
        </Field>
      </FormSection>
    </CreateLayout>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
