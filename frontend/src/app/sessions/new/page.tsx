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
import FileDrop from "@/components/form/FileDrop";
import { usePopularTags } from "@/components/form/usePopularTags";

export default function NewSession() {
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  const me = getStoredLearner();
  const [f, setF] = useState({
    title: "",
    abstract: "",
    body_md: "",
    presenter: "",
    session_date: "",
    recording_url: "",
  });
  const [tags, setTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popular = usePopularTags(() => api.listSessions());

  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const urlOk = !f.recording_url || /^https?:\/\/\S+\.\S+/.test(f.recording_url);

  async function submit() {
    if (!me) return setError(t("form.hub.signIn"));
    setBusy(true);
    setError(null);
    try {
      let deck: { file_name: string; file_original_name: string } | null = null;
      if (file) deck = await api.uploadDeck(file);
      const s = await api.createSession({
        title: f.title.trim(),
        abstract: f.abstract.trim(),
        body_md: f.body_md,
        presenter: f.presenter.trim() || me.handle,
        session_date: f.session_date || null,
        tags,
        file_name: deck?.file_name ?? null,
        file_original_name: deck?.file_original_name ?? null,
        recording_url: f.recording_url.trim() || null,
        learner_id: me.id,
        author: me.handle,
      });
      router.push(`/sessions/${s.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const presenter = f.presenter.trim() || me?.name || me?.handle || "";
  const date = f.session_date ? new Date(f.session_date) : null;

  const preview = (
    <article className="panel overflow-hidden">
      {/* A slide, roughly: the title card the deck would open on. */}
      <div className="relative aspect-video overflow-hidden border-b border-border bg-gradient-to-br from-surface-2 to-surface-3 p-5">
        <span
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(rgb(var(--chart-4)) 1px, transparent 1.2px)",
            backgroundSize: "14px 14px",
            maskImage: "linear-gradient(200deg, black, transparent 60%)",
            WebkitMaskImage: "linear-gradient(200deg, black, transparent 60%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-end">
          <p className={`line-clamp-2 text-lg font-semibold leading-tight tracking-tight ${f.title ? "text-text" : "text-text-subtle"}`}>
            {f.title || t("sess.new.titlePh")}
          </p>
          <p className="mt-1 text-xs text-text-muted">{presenter}</p>
        </div>
        <div className="absolute right-3 top-3 flex gap-1.5">
          {file && (
            <span className="badge bg-surface text-text-muted shadow-xs">
              <Icon name="file" size={11} /> {file.name.split(".").pop()?.toUpperCase()}
            </span>
          )}
          {f.recording_url && urlOk && (
            <span className="badge bg-surface text-text-muted shadow-xs">
              <Icon name="play" size={11} /> {t("sess.new.recording")}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        <p className="text-xs text-text-subtle tnum">
          {date ? fmt.date(date, { day: "numeric", month: "long", year: "numeric" }) : t("sess.new.noDate")}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-text-muted">{f.abstract || t("sess.new.abstractPh")}</p>
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
      back={{ href: "/sessions", label: t("sess.new.back") }}
      title={t("sess.new.title")}
      lede={t("sess.new.lede")}
      preview={preview}
      checklist={[
        { label: t("sess.new.ckTitle"), done: f.title.trim().length >= 4, required: true },
        { label: t("sess.new.ckAbstract"), done: f.abstract.trim().length >= 10 },
        { label: t("sess.new.ckMaterial"), done: !!file || (!!f.recording_url && urlOk) },
        { label: t("sess.new.ckDate"), done: !!f.session_date },
        { label: t("sess.new.ckTags"), done: tags.length > 0 },
        // Only listed while it is wrong: a typo in an optional link still
        // has to stop the post, or the session goes up with a dead link.
        ...(urlOk ? [] : [{ label: t("sess.new.ckValidUrl"), done: false, required: true }]),
      ]}
      error={error}
      submitLabel={t("sess.new.submit")}
      busyLabel={file ? t("sess.new.uploading") : t("sess.new.busy")}
      busy={busy}
      onSubmit={submit}
    >
      <FormSection step={1} title={t("sess.new.s1")} lede={t("sess.new.s1Lede")}>
        <Field id="s-title" label={t("sess.new.fTitle")} count={f.title.length} max={90}>
          <input id="s-title" name="title" className="input py-2.5 text-base font-medium" autoComplete="off" autoFocus placeholder={t("sess.new.titlePh")} value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field id="s-abstract" label={t("sess.new.fAbstract")} count={f.abstract.length} max={160}>
          <input id="s-abstract" name="abstract" className="input" autoComplete="off" placeholder={t("sess.new.abstractPh")} value={f.abstract} onChange={(e) => set("abstract", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="s-presenter" label={t("sess.new.fPresenter")} hint={t("sess.new.fPresenterHint", { me: me?.handle ?? "" })}>
            <input id="s-presenter" name="presenter" className="input" autoComplete="off" spellCheck={false} placeholder={me?.handle} value={f.presenter} onChange={(e) => set("presenter", e.target.value)} />
          </Field>
          <Field id="s-date" label={t("sess.new.fDate")} optional>
            <input id="s-date" name="session_date" type="date" className="input" value={f.session_date} onChange={(e) => set("session_date", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection step={2} title={t("sess.new.s2")} lede={t("sess.new.s2Lede")}>
        <Field id="s-deck" label={t("sess.new.fDeck")} optional>
          <FileDrop
            id="s-deck"
            file={file}
            onChange={setFile}
            accept=".pptx,.ppt,.pdf,.key"
            maxMb={60}
            label={t("sess.new.dropLabel")}
            hint={t("sess.new.dropHint")}
          />
        </Field>
        <Field
          id="s-rec"
          label={t("sess.new.fRecording")}
          optional
          error={urlOk ? null : t("sess.new.badUrl")}
          hint={t("sess.new.fRecordingHint")}
        >
          <input
            id="s-rec"
            name="recording_url"
            type="url"
            inputMode="url"
            className={`input ${urlOk ? "" : "border-bad focus:border-bad focus:ring-bad/25"}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            aria-invalid={!urlOk}
            value={f.recording_url}
            onChange={(e) => set("recording_url", e.target.value)}
          />
        </Field>
        <Field id="s-notes" label={t("sess.new.fNotes")} optional hint={t("sess.new.fNotesHint")}>
          <MarkdownField id="s-notes" value={f.body_md} onChange={(v) => set("body_md", v)} rows={7} describedBy="s-notes-hint" placeholder={t("sess.new.notesPh")} />
        </Field>
        <Field id="s-tags" label={t("sess.new.fTags")} optional>
          <TagInput id="s-tags" value={tags} onChange={setTags} suggestions={popular} />
        </Field>
      </FormSection>
    </CreateLayout>
  );
}
