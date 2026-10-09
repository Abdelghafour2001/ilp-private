"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type CertSuggestion,
  type Certification,
  type ComplianceRow,
  type EarnedCertificate,
  type Learner,
  type Team,
  type TeamMember,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";
import Icon from "@/components/Icon";
import Field from "@/components/form/Field";
import FileDrop from "@/components/form/FileDrop";
import { Segmented } from "@/components/form/Field";
import Modal from "@/components/Modal";
import ExpiryBadge from "@/components/ExpiryBadge";
import ListFilter, { useListFilter } from "@/components/ListFilter";
import { OVERSEER_ROLES } from "@/lib/nav";
import Pager, { pageOf } from "@/components/Pager";

// Who may add to the catalogue — mirrors `_can_curate` on the server.
const CURATOR_ROLES = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"];

const LEVEL_DOT: Record<string, string> = {
  beginner: "bg-good",
  intermediate: "bg-warn",
  advanced: "bg-bad",
};

function initials(s: string) {
  return s
    .split(/[\s.]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function CertificationsPage() {
  const t = useT();
  const format = useFormat();
  const fmtDate = (d: string | null) => (d ? format.date(d, { day: "numeric", month: "short", year: "numeric" }) : "");
  const [me, setMe] = useState<Learner | null>(null);
  const [catalog, setCatalog] = useState<Certification[]>([]);
  const [suggestions, setSuggestions] = useState<CertSuggestion[]>([]);
  const [feed, setFeed] = useState<EarnedCertificate[]>([]);
  // Follow-up, computed and scoped on the server (see /certifications/expiring).
  const [expiring, setExpiring] = useState<EarnedCertificate[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [scopeLabel, setScopeLabel] = useState("");
  const [openCompliance, setOpenCompliance] = useState<number | null>(null);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [suggestTeamId, setSuggestTeamId] = useState<number | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // detail modal
  const [selected, setSelected] = useState<Certification | null>(null);
  const [recNote, setRecNote] = useState("");
  const [recTargets, setRecTargets] = useState<number[]>([]);

  // share form
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState({
    certification_id: "",
    title: "",
    issuer: "",
    obtained_on: "",
    expires_on: "",
    credential_url: "",
  });
  const [file, setFile] = useState<File | null>(null);

  // add-to-catalog form
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    provider: "",
    level: "beginner",
    url: "",
    description: "",
    client_required: false,
    client_name: "",
    validity_months: 0,
  });

  const canCurate = !!me && CURATOR_ROLES.includes(me.role ?? "");
  const canSuggest =
    myTeams.length > 0 || ["hr", "hr_lead", "admin"].includes(me?.role ?? "");
  // Managers, BU heads, HRBPs and L&D follow renewals — each over their own
  // perimeter. This used to be `hr` or `admin` only, which left L&D and every
  // line manager without the list, and filtered the 30 most recently *shared*
  // certificates in the browser, so an old one dropped out exactly when it
  // started to matter. The server now returns the full, scoped list, with
  // client-required certificates first.
  const isOverseer = OVERSEER_ROLES.includes(me?.role ?? "");
  const catalogFilter = useListFilter(catalog, (c) => ({
    haystack: [c.name, c.provider, c.description, c.client_name].join(" "),
    tags: [
      c.level,
      c.provider,
      ...(c.client_required ? [t("certs.tagClientRequired")] : []),
      ...(c.validity_months > 0 ? [t("certs.tagRenewable")] : []),
    ].filter(Boolean) as string[],
  }));

  // Both lists grow without limit — 40-odd certifications and every
  // certificate anybody ever shared — so neither is a page you scroll.
  const [catalogPage, setCatalogPage] = useState(0);
  const [feedPage, setFeedPage] = useState(0);

  useEffect(() => setCatalogPage(0), [catalogFilter.filtered.length]);

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api.listCertifications().then(setCatalog).catch((e) => setError(String(e)));
    api.certFeed().then(setFeed).catch(() => {});
    if (learner && OVERSEER_ROLES.includes(learner.role ?? "")) {
      api
        .certExpiring(learner.id)
        .then((r) => {
          setExpiring(r.items);
          setScopeLabel(r.scope);
        })
        .catch(() => setExpiring([]));
      api
        .certCompliance(learner.id)
        .then((r) => setCompliance(r.certifications))
        .catch(() => setCompliance([]));
    }
    if (learner) {
      api.certSuggestions(learner.id).then(setSuggestions).catch(() => {});
      api
        .listTeams(learner.id)
        .then((ts) => {
          setMyTeams(ts);
          setSuggestTeamId((cur) => cur ?? ts[0]?.id ?? null);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Certificates arrive while the page is open — somebody shares one, the
  // nightly sync records another — and a stale "recently earned" list is the
  // one thing this page must not show. Refresh on a timer, and again whenever
  // the tab is brought back to the front.
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // load team members for the "recommend to individuals" picker
  useEffect(() => {
    if (!selected || !canSuggest || !suggestTeamId) {
      setMembers([]);
      return;
    }
    api
      .teamDashboard(suggestTeamId, getStoredLearner()?.id)
      .then((d) => setMembers(d.members))
      .catch(() => setMembers([]));
  }, [selected, canSuggest, suggestTeamId]);

  function closeModal() {
    setSelected(null);
    setRecNote("");
    setRecTargets([]);
  }

  async function doSuggest(cert: Certification, opts: { teamId?: number | null; targetIds?: number[] }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.suggestCertification(cert.id, { ...opts, note: recNote }, me?.id);
      const parts = [];
      if (res.created.length) parts.push(`Suggested to ${res.created.join(", ")} ✓`);
      if (res.skipped.length) parts.push(res.skipped.map((s) => `${s.target}: ${s.reason}`).join(" · "));
      setNotice(parts.join(" — "));
      closeModal();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(s: CertSuggestion) {
    const what = s.team_name || s.target_handle;
    if (!confirm(t("cert.confirmWithdraw", { name: s.certification.name, who: what ?? "" }))) return;
    await api.withdrawCertSuggestion(s.id, me?.id ?? undefined).catch((e) => setError(String(e)));
    refresh();
  }

  async function submitShare() {
    if (!me) {
      setError(t("form.hub.signIn"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let uploaded: { file_name: string; file_original_name: string } | null = null;
      if (file) uploaded = await api.uploadCertificateFile(file);
      await api.shareCertificate({
        learner_id: me.id,
        certification_id: share.certification_id ? Number(share.certification_id) : null,
        title: share.title,
        issuer: share.issuer,
        obtained_on: share.obtained_on || null,
        expires_on: share.expires_on || null,
        credential_url: share.credential_url,
        file_name: uploaded?.file_name ?? null,
        file_original_name: uploaded?.file_original_name ?? null,
      });
      setShare({
        certification_id: "",
        title: "",
        issuer: "",
        obtained_on: "",
        expires_on: "",
        credential_url: "",
      });
      setFile(null);
      setSharing(false);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addToCatalog() {
    setBusy(true);
    setError(null);
    try {
      await api.addCertification({ ...draft, tags: [], learner_id: me?.id });
      setDraft({
        name: "",
        provider: "",
        level: "beginner",
        url: "",
        description: "",
        client_required: false,
        client_name: "",
        validity_months: 0,
      });
      setAdding(false);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeEarned(e: EarnedCertificate) {
    if (!confirm(t("cert.confirmRemove", { title: e.title, who: e.name || e.handle }))) return;
    await api.deleteEarnedCertificate(e.id, me?.id ?? undefined).catch((err) => setError(String(err)));
    refresh();
  }

  const personal = suggestions.filter((s) => s.target_id != null && s.target_id === me?.id);
  const teamSugg = suggestions.filter((s) => s.team_id != null);
  const suggestedIds = new Set(
    teamSugg.filter((s) => s.team_id === suggestTeamId).map((s) => s.certification.id),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("certs.title")}</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{t("cert.lede")}</p>
        </div>
        <button type="button" className="btn" onClick={() => setSharing(true)}>
          <Icon name="award" size={16} /> {t("cert.shareBtn")}
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
          <Icon name="check" size={15} className="text-good" /> {notice}
        </p>
      )}

      {/* Declaring a certificate is a dialog: the form used to open above the
          catalogue and push it off the screen while somebody filled it in. */}
      {sharing && (
        <Modal
          title={t("certs.share")}
          lede={t("certs.shareLede", "From the catalogue, or any certificate you hold.")}
          onClose={() => setSharing(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setSharing(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                disabled={busy || (!share.title.trim() && !share.certification_id)}
                onClick={submitShare}
              >
                {busy ? t("cert.sharing") : t("cert.shareIt")}
              </button>
            </>
          }
        >
          <Field id="sh-cat" label={t("cert.f.which")} hint={t("cert.f.whichHint")}>
            <select
              id="sh-cat"
              className="input"
              value={share.certification_id}
              onChange={(e) => setShare({ ...share, certification_id: e.target.value })}
            >
              <option value="">{t("cert.f.notInCatalog")}</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.provider ? ` — ${c.provider}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sh-title" label={t("cert.f.title")} optional={share.certification_id ? t("cert.f.catalogName") : false}>
              <input
                id="sh-title"
                className="input"
                autoComplete="off"
                placeholder="Azure Data Fundamentals (DP-900)"
                value={share.title}
                onChange={(e) => setShare({ ...share, title: e.target.value })}
              />
            </Field>
            <Field id="sh-issuer" label={t("cert.f.issuer")} optional>
              <input id="sh-issuer" className="input" autoComplete="off" placeholder="Microsoft" value={share.issuer} onChange={(e) => setShare({ ...share, issuer: e.target.value })} />
            </Field>
            <Field id="sh-obtained" label={t("certs.obtainedOn")} optional>
              <input id="sh-obtained" className="input" type="date" value={share.obtained_on} onChange={(e) => setShare({ ...share, obtained_on: e.target.value })} />
            </Field>
            <Field id="sh-expires" label={t("cert.f.expires")} optional hint={t("cert.f.expiresHint")}>
              <input id="sh-expires" className="input" type="date" min={share.obtained_on || undefined} value={share.expires_on} onChange={(e) => setShare({ ...share, expires_on: e.target.value })} />
            </Field>
          </div>
          <Field id="sh-url" label={t("cert.f.url")} optional hint={t("cert.f.urlHint")}>
            <input
              id="sh-url"
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.credly.com/badges/…"
              value={share.credential_url}
              onChange={(e) => setShare({ ...share, credential_url: e.target.value })}
            />
          </Field>
          <Field id="sh-file" label={t("cert.f.file")} optional>
            <FileDrop
              id="sh-file"
              file={file}
              onChange={setFile}
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              maxMb={10}
              label={t("cert.f.drop")}
              hint={t("cert.f.dropHint")}
            />
          </Field>
        </Modal>
      )}

      {/* personal recommendations */}
      {personal.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Icon name="sparkles" size={16} className="text-accent-text" /> {t("cert.forYou")}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {personal.map((s) => (
              <div key={s.id} className="panel space-y-1.5 border-accent/40 p-5 shadow-glow">
                <CertTitle name={s.certification.name} level={s.certification.level} provider={s.certification.provider} />
                {s.note && <blockquote className="border-l-2 border-accent/40 pl-3 text-sm italic text-text-muted">{s.note}</blockquote>}
                <p className="text-xs text-text-subtle">
                  {t("certs.pickedFor")} <span className="font-medium text-text">{s.suggested_by_name}</span>
                </p>
                {s.certification.url && (
                  <a href={s.certification.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">
                    {t("cert.about")} <Icon name="external" size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* suggestions for my team(s) */}
      {teamSugg.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">{t("cert.forTeam")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {teamSugg.map((s) => (
              <div key={s.id} className="panel flex flex-col gap-1.5 p-5">
                <CertTitle name={s.certification.name} level={s.certification.level} provider={s.certification.provider} />
                {s.note && <blockquote className="border-l-2 border-border-strong pl-3 text-sm italic text-text-muted">{s.note}</blockquote>}
                <p className="text-xs text-text-subtle">
                  {t("cert.forTeamBy", { team: s.team_name ?? "", who: s.suggested_by_name })}
                </p>
                <div className="mt-auto flex items-center gap-3 pt-1 text-xs">
                  {s.certification.url && (
                    <a href={s.certification.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                      {t("cert.about")} <Icon name="external" size={11} />
                    </a>
                  )}
                  {(me?.role === "admin" || me?.role === "hr" ||
                    s.suggested_by_name === (me?.handle ?? "")) && (
                    <button type="button" className="ml-auto text-text-subtle hover:text-bad" onClick={() => withdraw(s)}>
                      {t("cert.withdraw")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* catalog */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("cert.catalog")}</h2>
          <div className="flex items-center gap-2">
            {canSuggest && myTeams.length > 1 && (
              <select
                className="input w-auto max-w-[240px] py-1.5 text-sm"
                aria-label={t("certs.actingFor")}
                title={t("certs.actingFor")}
                value={suggestTeamId ?? ""}
                onChange={(e) => setSuggestTeamId(Number(e.target.value))}
              >
                {myTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {canCurate && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} /> {t("cert.addToCatalog")}
              </button>
            )}
          </div>
        </div>

        {adding && (
          <Modal
            title={t("cert.addToCatalog")}
            lede={t("cert.addLede")}
            size="md"
            onClose={() => setAdding(false)}
            footer={
              <>
                <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn" disabled={busy || !draft.name.trim()} onClick={addToCatalog}>
                  {t("certs.add")}
                </button>
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cc-name" label={t("cert.f.name")} className="sm:col-span-2">
                <input id="cc-name" className="input" autoComplete="off" autoFocus placeholder="Databricks Data Engineer Associate" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field id="cc-provider" label={t("cert.f.provider")} optional>
                <input id="cc-provider" className="input" autoComplete="off" placeholder="Databricks" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-medium">{t("cb.f.level")}</p>
                <Segmented
                  label={t("cb.f.level")}
                  value={draft.level as "beginner"}
                  onChange={(level) => setDraft({ ...draft, level })}
                  options={(["beginner", "intermediate", "advanced"] as const).map((l) => ({
                    value: l as "beginner",
                    label: <span className="capitalize">{t(`common.${l}`, l)}</span>,
                  }))}
                />
              </div>
              <Field id="cc-desc" label={t("cert.f.why")} optional className="sm:col-span-2">
                <input id="cc-desc" className="input" autoComplete="off" placeholder={t("certs.oneLine")} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field id="cc-url" label={t("cert.f.info")} optional className="sm:col-span-2">
                <input id="cc-url" className="input" type="url" inputMode="url" spellCheck={false} placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              </Field>
            </div>
            {/* Compliance side: a client-required certification that lapses is
                a contractual problem, not just a missed learning opportunity. */}
            <div className="space-y-3 rounded-xl border border-border p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                  checked={draft.client_required}
                  onChange={(e) => setDraft({ ...draft, client_required: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium">{t("certs.clientRequiredToggle")}</span>
                  <span className="block text-xs text-text-subtle">{t("certs.clientRequiredHint")}</span>
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                {draft.client_required && (
                  <Field id="cc-client" label={t("cert.f.client")}>
                    <input id="cc-client" className="input" autoComplete="off" placeholder={t("certs.clientNamePlaceholder")} value={draft.client_name} onChange={(e) => setDraft({ ...draft, client_name: e.target.value })} />
                  </Field>
                )}
                <Field id="cc-validity" label={t("certs.validity")} hint={t("certs.validityHint")}>
                  <div className="relative">
                    <input
                      id="cc-validity"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="input pr-20"
                      value={draft.validity_months}
                      onChange={(e) => setDraft({ ...draft, validity_months: Number(e.target.value) || 0 })}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-subtle">{t("certs.months")}</span>
                  </div>
                </Field>
              </div>
            </div>
          </Modal>
        )}

        {catalog.length > 0 && (
          <ListFilter
            placeholder={t("certs.searchPlaceholder")}
            {...catalogFilter}
            total={catalog.length}
            shown={catalogFilter.filtered.length}
          />
        )}

        {catalogFilter.filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
            {catalog.length ? t("filter.noMatch") : t("certs.catalogEmpty")}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pageOf(catalogFilter.filtered, catalogPage).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className="group flex h-full flex-col rounded-xl border border-border bg-surface p-5 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-text-muted transition-colors group-hover:bg-accent/10 group-hover:text-accent-text">
                  <Icon name="award" size={18} />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold leading-snug group-hover:text-accent-text">{c.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-subtle">
                    <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[c.level] ?? "bg-text-subtle"}`} />
                    <span className="capitalize">{t(`common.${c.level}`, c.level)}</span>
                    {c.provider && (
                      <>
                        <span>·</span>
                        <span>{c.provider}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {c.description && <p className="mt-3 line-clamp-2 text-sm text-text-muted">{c.description}</p>}

              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-xs">
                {c.client_required && (
                  <span className="badge badge-warn" title={t("certs.clientRequiredHint")}>
                    {c.client_name ? t("certs.clientRequiredNamed", { client: c.client_name }) : t("certs.clientRequired")}
                  </span>
                )}
                {c.validity_months > 0 && (
                  <span className="inline-flex items-center gap-1 text-text-subtle">
                    <Icon name="clock" size={12} /> {t("certs.validFor", { count: c.validity_months })}
                  </span>
                )}
                {c.earned_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-good">
                    <Icon name="check" size={12} /> {t("certs.earnedHere", { count: c.earned_count })}
                  </span>
                )}
                {suggestedIds.has(c.id) && (
                  <span className="inline-flex items-center gap-1 text-accent-text">
                    <Icon name="team" size={12} /> {t("certs.suggested")}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
        <Pager page={catalogPage} total={catalogFilter.filtered.length} onPage={setCatalogPage} />
      </div>

      {/* follow-up: expiring or recently lapsed, within the viewer's scope */}
      {isOverseer && expiring.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold">
            <Icon name="clock" size={16} className="self-center text-warn" /> {t("certs.expiringSoon")}
            {scopeLabel && <span className="text-xs font-normal text-text-subtle">{scopeLabel}</span>}
          </h2>
          <div className="panel divide-y divide-border overflow-hidden border-warn/30">
            {expiring.map((e) => (
              <div key={`soon-${e.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warn/10 text-xs font-semibold text-warn">
                  {initials(e.name || e.handle)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      <span className="font-medium">{e.name || e.handle}</span>
                      <span className="text-text-subtle"> · </span>
                      <span className="font-medium text-text">{e.title}</span>
                      {e.issuer && <span className="text-text-muted"> · {e.issuer}</span>}
                    </span>
                    {e.client_required && (
                      <span className="badge bg-warn/15 text-warn">
                        {e.client_name
                          ? t("certs.clientRequiredNamed", { client: e.client_name })
                          : t("certs.expiredClient")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-text-subtle">
                    {t("certs.validUntil", { date: fmtDate(e.expires_on) })}
                    {e.team_name && ` · ${e.team_name}`}
                  </p>
                </div>
                <ExpiryBadge expiresOn={e.expires_on} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* compliance: client-required certifications, who is covered and who is not */}
      {isOverseer && compliance.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold">
              <Icon name="admin" size={16} className="self-center text-text-muted" /> {t("certs.compliance")}
              {scopeLabel && <span className="text-xs font-normal text-text-subtle">{scopeLabel}</span>}
            </h2>
            <p className="mt-1 max-w-[70ch] text-sm text-text-muted">{t("certs.complianceHint")}</p>
          </div>
          <div className="panel divide-y divide-border overflow-hidden">
            {compliance.map((row) => {
              const open = openCompliance === row.certification_id;
              const buckets: [string, string, typeof row.valid][] = [
                ["certs.bucket.missing", "bg-bad/15 text-bad", row.missing],
                ["certs.bucket.lapsed", "bg-bad/15 text-bad", row.lapsed],
                ["certs.bucket.expiring", "bg-warn/15 text-warn", row.expiring],
                ["certs.bucket.valid", "bg-good/15 text-good", row.valid],
              ];
              return (
                <div key={row.certification_id} className="space-y-3 px-5 py-3.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => setOpenCompliance(open ? null : row.certification_id)}
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      <strong>{row.name}</strong>
                      {row.client_name && (
                        <span className="text-text-muted"> · {row.client_name}</span>
                      )}
                    </span>
                    {buckets.map(([key, tone, people]) =>
                      people.length > 0 ? (
                        <span key={key} className={`badge ${tone} tnum`}>
                          {people.length} {t(key)}
                        </span>
                      ) : null,
                    )}
                    <Icon name="chevron-down" size={15} className={`text-text-subtle transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {!row.audience_defined && (
                    <p className="text-xs text-text-subtle">{t("certs.noAudience")}</p>
                  )}
                  {open && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {buckets
                        .filter(([, , people]) => people.length > 0)
                        .map(([key, , people]) => (
                          <div key={key}>
                            <p className="mb-1 text-xs font-medium capitalize text-text-subtle">{t(key)}</p>
                            <ul className="space-y-0.5 text-sm">
                              {people.map((p) => (
                                <li key={p.learner_id} className="flex justify-between gap-2">
                                  <span>
                                    {p.name}
                                    {p.bu && <span className="text-text-subtle"> · {p.bu}</span>}
                                  </span>
                                  {p.expires_on && (
                                    <span className="text-xs text-text-subtle tnum">
                                      {fmtDate(p.expires_on)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* recently shared */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("cert.recent")}</h2>
        {feed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
            {t("cert.emptyFeed")}
          </div>
        ) : (
          <ul className="panel divide-y divide-border overflow-hidden">
            {pageOf(feed, feedPage).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-xs font-semibold text-accent-text" aria-hidden="true">
                  {initials(e.name || e.handle)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                    <span>{t("cert.earned", { who: e.name || e.handle })}</span>
                    <span className="font-semibold text-text">{e.title}</span>
                    {e.issuer && <span className="text-text-muted">· {e.issuer}</span>}
                    <ExpiryBadge expiresOn={e.expires_on} />
                  </p>
                  <p className="mt-0.5 text-xs text-text-subtle tnum">
                    {e.obtained_on ? fmtDate(e.obtained_on) : fmtDate(e.created_at)}
                    {e.expires_on && <span> · {t("certs.validUntil", { date: fmtDate(e.expires_on) })}</span>}
                    {e.team_name && ` · ${e.team_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {e.has_file && (
                    <a href={api.certificateFileUrl(e.id)} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                      <Icon name="file" size={13} /> {t("certs.view")}
                    </a>
                  )}
                  {e.credential_url && (
                    <a href={e.credential_url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                      {t("cert.verify")} <Icon name="external" size={12} />
                    </a>
                  )}
                  {(me?.id === e.learner_id || me?.role === "admin") && (
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-md text-text-subtle hover:bg-bad/10 hover:text-bad"
                      aria-label={t("cert.removeOne", { title: e.title })}
                      title={t("cert.removeOne", { title: e.title })}
                      onClick={() => removeEarned(e)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={feedPage} total={feed.length} onPage={setFeedPage} />
      </section>

      {/* ---- certification detail ---- */}
      {selected && (
        <Modal
          title={selected.name}
          lede={[selected.provider, t("cert.addedBy", { who: selected.added_by_name })].filter(Boolean).join(" · ")}
          size="md"
          onClose={closeModal}
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[selected.level] ?? "bg-text-subtle"}`} />
              <span className="capitalize">{t(`common.${selected.level}`, selected.level)}</span>
            </span>
            {selected.validity_months > 0 && (
              <span className="inline-flex items-center gap-1 text-text-muted">
                <Icon name="clock" size={13} /> {t("certs.validFor", { count: selected.validity_months })}
              </span>
            )}
            {selected.earned_count > 0 && (
              <span className="inline-flex items-center gap-1 text-good">
                <Icon name="check" size={13} /> {t("certs.earnedHere", { count: selected.earned_count })}
              </span>
            )}
          </p>
          {selected.description && <p className="text-sm leading-relaxed text-text-muted">{selected.description}</p>}
          {selected.url && (
            <a href={selected.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-sm">
              {t("cert.official")} <Icon name="external" size={13} />
            </a>
          )}

          {/* recommend controls — leads / managers / HR */}
          {canSuggest && (
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{t("cert.recommend")}</h3>
              <Field id="rec-note" label={t("cert.f.note")} optional>
                <input id="rec-note" className="input" autoComplete="off" placeholder={t("certs.noteWhy")} value={recNote} onChange={(e) => setRecNote(e.target.value)} />
              </Field>
              {members.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("cert.f.who")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const on = recTargets.includes(m.learner_id);
                      return (
                        <button
                          key={m.learner_id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setRecTargets((cur) => (on ? cur.filter((id) => id !== m.learner_id) : [...cur, m.learner_id]))
                          }
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                            on ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                          }`}
                        >
                          {on && <Icon name="check" size={11} strokeWidth={2.5} />}
                          {m.name || m.handle}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-subtle">{t("certs.noTeam")}</p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || !suggestTeamId || suggestedIds.has(selected.id)}
                  onClick={() => doSuggest(selected, { teamId: suggestTeamId })}
                >
                  {suggestedIds.has(selected.id) ? (
                    <>
                      <Icon name="check" size={14} /> {t("cert.suggestedTeam")}
                    </>
                  ) : (
                    t("cert.suggestTeam")
                  )}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || recTargets.length === 0}
                  onClick={() => doSuggest(selected, { targetIds: recTargets })}
                >
                  {recTargets.length ? t("cert.recommendTo", { n: recTargets.length }) : t("cert.pickPeople")}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function CertTitle({ name, level, provider }: { name: string; level: string; provider?: string | null }) {
  const t = useT();
  return (
    <div>
      <p className="font-semibold leading-snug">{name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-subtle">
        <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[level] ?? "bg-text-subtle"}`} />
        <span className="capitalize">{t(`common.${level}`, level)}</span>
        {provider && (
          <>
            <span>·</span>
            <span>{provider}</span>
          </>
        )}
      </p>
    </div>
  );
}
