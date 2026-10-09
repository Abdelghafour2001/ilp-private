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
import { useT } from "@/lib/i18n";
import Modal from "@/components/Modal";
import ExpiryBadge from "@/components/ExpiryBadge";
import ListFilter, { useListFilter } from "@/components/ListFilter";
import { OVERSEER_ROLES } from "@/lib/nav";
import Pager, { pageOf } from "@/components/Pager";

// Who may add to the catalogue — mirrors `_can_curate` on the server.
const CURATOR_ROLES = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"];

const LEVEL_BADGE: Record<string, string> = {
  beginner: "bg-good/15 text-good",
  intermediate: "bg-warn/15 text-warn",
  advanced: "bg-bad/15 text-bad",
};

function fmtDate(d: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function CertificationsPage() {
  const t = useT();
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

  // Esc closes the modal
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    if (!confirm(`Withdraw the suggestion "${s.certification.name}" for ${what}?`)) return;
    await api.withdrawCertSuggestion(s.id, me?.id ?? undefined).catch((e) => setError(String(e)));
    refresh();
  }

  async function submitShare() {
    if (!me) {
      setError("Pick a handle first (top-right) so the certificate has an owner.");
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
    if (!confirm(`Remove "${e.title}" shared by ${e.handle}?`)) return;
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
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Certifications</h1>
          <p className="mt-1 text-sm text-text-muted">
            The team&apos;s certification catalog, your leads&apos; suggestions, and who earned what —
            achievements in the open, not buried in inboxes.
          </p>
        </div>
        <button className="btn" onClick={() => setSharing((v) => !v)}>
          {sharing ? "Close" : "🏅 Share a certificate"}
        </button>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {notice && <div className="card border-good/40 text-sm text-good">{notice}</div>}

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
                {busy ? "Sharing…" : "Share it 🎉"}
              </button>
            </>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="input"
              value={share.certification_id}
              onChange={(e) => setShare({ ...share, certification_id: e.target.value })}
            >
              <option value="">{t("certs.fromCatalog")}</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder={share.certification_id ? "Title (optional — catalog name used)" : "Certificate title"}
              value={share.title}
              onChange={(e) => setShare({ ...share, title: e.target.value })}
            />
            <input
              className="input"
              placeholder={t("certs.issuer")}
              value={share.issuer}
              onChange={(e) => setShare({ ...share, issuer: e.target.value })}
            />
            <input
              className="input"
              type="date"
              title={t("certs.obtainedOn")}
              value={share.obtained_on}
              onChange={(e) => setShare({ ...share, obtained_on: e.target.value })}
            />
            <input
              className="input"
              type="date"
              title={t("certs.validUntil")}
              value={share.expires_on}
              onChange={(e) => setShare({ ...share, expires_on: e.target.value })}
            />
          </div>
          <p className="text-xs text-text-subtle">
            Valide jusqu&apos;au (optionnel) — laissez vide si la certification n&apos;expire pas.
          </p>
          <input
            className="input"
            placeholder={t("certs.credentialUrl")}
            value={share.credential_url}
            onChange={(e) => setShare({ ...share, credential_url: e.target.value })}
          />
          <label className="block text-xs text-text-subtle">
            {t("certs.file")}
            <input
              className="mt-1 block w-full text-sm text-text-subtle file:mr-3 file:rounded-lg file:border-0 file:bg-edge file:px-3 file:py-2 file:text-text"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </Modal>
      )}

      {/* personal recommendations */}
      {personal.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-text">
            🎯 Recommended for you
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {personal.map((s) => (
              <div key={s.id} className="card space-y-1.5 border-accent/40 shadow-glow">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{s.certification.name}</p>
                  <span className={`badge ${LEVEL_BADGE[s.certification.level] ?? "bg-edge"}`}>
                    {s.certification.level}
                  </span>
                </div>
                {s.note && <p className="text-sm text-text-muted">“{s.note}”</p>}
                <p className="text-xs text-text-subtle">
                  {t("certs.pickedFor")} <strong className="text-text">{s.suggested_by_name}</strong>
                </p>
                {s.certification.url && (
                  <a href={s.certification.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                    {t("certs.about")}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📌 Suggested for your team
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {teamSugg.map((s) => (
              <div key={s.id} className="card space-y-1.5 border-accent/30">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{s.certification.name}</p>
                  <span className={`badge ${LEVEL_BADGE[s.certification.level] ?? "bg-edge"}`}>
                    {s.certification.level}
                  </span>
                  {s.certification.provider && (
                    <span className="badge bg-edge text-text-subtle">{s.certification.provider}</span>
                  )}
                </div>
                {s.note && <p className="text-sm text-text-muted">“{s.note}”</p>}
                <p className="text-xs text-text-subtle">
                  For <strong className="text-text">{s.team_name}</strong> · suggested by {s.suggested_by_name}
                </p>
                <div className="flex gap-3 text-xs">
                  {s.certification.url && (
                    <a href={s.certification.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      About this certification ↗
                    </a>
                  )}
                  {(me?.role === "admin" || me?.role === "hr" ||
                    s.suggested_by_name === (me?.handle ?? "")) && (
                    <button className="text-bad hover:underline" onClick={() => withdraw(s)}>
                      withdraw
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📚 {t("certs.catalogTitle")}
          </p>
          <div className="flex items-center gap-2">
            {canSuggest && myTeams.length > 1 && (
              <select
                className="input max-w-[220px] py-1 text-xs"
                title={t("certs.actingFor")}
                value={suggestTeamId ?? ""}
                onChange={(e) => setSuggestTeamId(Number(e.target.value))}
              >
                {myTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    → {t.name}
                  </option>
                ))}
              </select>
            )}
            {canCurate && (
              <button className="btn-ghost btn-sm" onClick={() => setAdding((v) => !v)}>
                {adding ? "Close" : "+ Add to catalog"}
              </button>
            )}
          </div>
        </div>

        {adding && (
          <div className="card space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder={t("certs.name")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <input className="input" placeholder={t("certs.provider")} value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
              <select className="input" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
                <option value="beginner">beginner</option>
                <option value="intermediate">intermediate</option>
                <option value="advanced">advanced</option>
              </select>
              <input className="input" placeholder={t("certs.infoUrl")} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            </div>
            <input className="input" placeholder={t("certs.oneLine")} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            {/* Compliance side: a client-required certification that lapses is
                a contractual problem, not just a missed learning opportunity. */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={draft.client_required}
                  onChange={(e) => setDraft({ ...draft, client_required: e.target.checked })}
                />
                {t("certs.clientRequiredToggle")}
              </label>
              {draft.client_required && (
                <input
                  className="input max-w-[220px] py-1 text-sm"
                  placeholder={t("certs.clientNamePlaceholder")}
                  value={draft.client_name}
                  onChange={(e) => setDraft({ ...draft, client_name: e.target.value })}
                />
              )}
              <label className="flex items-center gap-2 text-sm text-text-muted">
                {t("certs.validity")}
                <input
                  type="number"
                  min={0}
                  className="input w-20 py-1 text-sm"
                  value={draft.validity_months}
                  onChange={(e) =>
                    setDraft({ ...draft, validity_months: Number(e.target.value) || 0 })
                  }
                />
                {t("certs.months")}
              </label>
              <span className="text-xs text-text-subtle">
                {t("certs.validityHint")}
              </span>
            </div>
            <button className="btn-soft" disabled={busy || !draft.name.trim()} onClick={addToCatalog}>
              {t("certs.add")}
            </button>
          </div>
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
          <div className="card text-center text-sm text-text-subtle">
            {catalog.length ? t("filter.noMatch") : t("certs.catalogEmpty")}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pageOf(catalogFilter.filtered, catalogPage).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="card flex h-full flex-col gap-2 text-left transition hover:border-accent hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-snug">{c.name}</p>
                <span className={`badge shrink-0 ${LEVEL_BADGE[c.level] ?? "bg-edge"}`}>{c.level}</span>
              </div>

              <p className="text-xs text-text-subtle">{c.provider || "—"}</p>

              {c.description && (
                <p className="line-clamp-2 text-sm text-text-muted">{c.description}</p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                {c.client_required && (
                  <span
                    className="badge bg-warn/15 text-warn"
                    title={t("certs.clientRequiredHint")}
                  >
                    {c.client_name
                      ? t("certs.clientRequiredNamed", { client: c.client_name })
                      : t("certs.clientRequired")}
                  </span>
                )}
                {c.validity_months > 0 && (
                  <span className="badge bg-edge text-text-subtle">
                    ♻️ {t("certs.validFor", { count: c.validity_months })}
                  </span>
                )}
                {c.earned_count > 0 && (
                  <span className="badge bg-good/15 text-good">
                    🏅 {t("certs.earnedHere", { count: c.earned_count })}
                  </span>
                )}
                {suggestedIds.has(c.id) && (
                  <span className="badge bg-accent/15 text-accent-text">
                    📌 {t("certs.suggested")}
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
          <p className="text-xs font-semibold uppercase tracking-wide text-warn">
            ⏳ {t("certs.expiringSoon")}
            {scopeLabel && <span className="ml-2 normal-case text-text-subtle">· {scopeLabel}</span>}
          </p>
          <div className="space-y-2">
            {expiring.map((e) => (
              <div key={`soon-${e.id}`} className="card flex flex-wrap items-center gap-3 border-warn/30 py-3">
                <span className="text-2xl">🏅</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      <strong>{e.name || e.handle}</strong> ·{" "}
                      <strong className="text-accent">{e.title}</strong>
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🛡️ {t("certs.compliance")}
            {scopeLabel && <span className="ml-2 normal-case">· {scopeLabel}</span>}
          </p>
          <p className="text-xs text-text-subtle">{t("certs.complianceHint")}</p>
          <div className="space-y-2">
            {compliance.map((row) => {
              const open = openCompliance === row.certification_id;
              const buckets: [string, string, typeof row.valid][] = [
                ["certs.bucket.missing", "bg-bad/15 text-bad", row.missing],
                ["certs.bucket.lapsed", "bg-bad/15 text-bad", row.lapsed],
                ["certs.bucket.expiring", "bg-warn/15 text-warn", row.expiring],
                ["certs.bucket.valid", "bg-good/15 text-good", row.valid],
              ];
              return (
                <div key={row.certification_id} className="card space-y-2 py-3">
                  <button
                    type="button"
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
                    <span className="text-xs text-text-subtle">{open ? "▲" : "▼"}</span>
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
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                              {t(key)}
                            </p>
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
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
          🎉 Recently earned
        </p>
        {feed.length === 0 && (
          <div className="card text-center text-sm text-text-subtle">
            {t("certs.empty")}
          </div>
        )}
        <div className="space-y-2">
          {pageOf(feed, feedPage).map((e) => (
            <div key={e.id} className="card flex flex-wrap items-center gap-3 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-text">
                {(e.name || e.handle)
                  .split(/[\s.]+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "")
                  .join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <strong>{e.name || e.handle}</strong> earned{" "}
                  <strong className="text-accent">{e.title}</strong>
                  {e.issuer && <span className="text-text-muted"> · {e.issuer}</span>}
                  <span className="ml-2 inline-flex align-middle">
                    <ExpiryBadge expiresOn={e.expires_on} />
                  </span>
                </p>
                <p className="text-xs text-text-subtle">
                  {e.obtained_on ? fmtDate(e.obtained_on) : fmtDate(e.created_at)}
                  {e.expires_on && (
                    <span> · valide jusqu&apos;au {fmtDate(e.expires_on)}</span>
                  )}
                  {e.team_name && ` · ${e.team_name}`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {e.has_file && (
                  <a href={api.certificateFileUrl(e.id)} target="_blank" rel="noreferrer" className="btn-soft btn-sm">
                    {t("certs.view")}
                  </a>
                )}
                {e.credential_url && (
                  <a href={e.credential_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {t("certs.verify")}
                  </a>
                )}
                {(me?.id === e.learner_id || me?.role === "admin") && (
                  <button className="text-bad hover:underline" onClick={() => removeEarned(e)}>
                    remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <Pager page={feedPage} total={feed.length} onPage={setFeedPage} />
      </div>

      {/* ---- certification detail modal — click outside (or Esc) to dismiss ---- */}
      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto animate-scale-in rounded-2xl border border-border bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={selected.name}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-4xl">🎖️</span>
              <button className="btn-icon" aria-label={t("common.close")} onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{selected.name}</h2>
              <span className={`badge ${LEVEL_BADGE[selected.level] ?? "bg-edge"}`}>{selected.level}</span>
            </div>
            <p className="mt-1 text-sm text-text-subtle">
              {selected.provider && <>by <strong className="text-text">{selected.provider}</strong> · </>}
              added by {selected.added_by_name}
              {selected.earned_count > 0 && (
                <span className="ml-1 text-good">· 🏅 {selected.earned_count} earned here</span>
              )}
            </p>
            {selected.description && (
              <p className="mt-3 text-sm text-text-muted">{selected.description}</p>
            )}
            {selected.url && (
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm text-accent hover:underline"
              >
                {t("certs.official")}
              </a>
            )}

            {/* recommend controls — leads / managers / HR */}
            {canSuggest && (
              <div className="mt-5 space-y-3 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  📌 Recommend it
                </p>
                <input
                  className="input"
                  placeholder={t("certs.noteWhy")}
                  value={recNote}
                  onChange={(e) => setRecNote(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-soft btn-sm"
                    disabled={busy || !suggestTeamId || suggestedIds.has(selected.id)}
                    onClick={() => doSuggest(selected, { teamId: suggestTeamId })}
                  >
                    {suggestedIds.has(selected.id) ? "✓ suggested to team" : "Suggest to whole team"}
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || recTargets.length === 0}
                    onClick={() => doSuggest(selected, { targetIds: recTargets })}
                  >
                    Recommend to {recTargets.length || "…"} selected
                  </button>
                </div>
                {members.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const on = recTargets.includes(m.learner_id);
                      return (
                        <button
                          key={m.learner_id}
                          onClick={() =>
                            setRecTargets((cur) =>
                              on ? cur.filter((id) => id !== m.learner_id) : [...cur, m.learner_id],
                            )
                          }
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            on
                              ? "border-accent bg-accent/15 font-medium text-accent-text"
                              : "border-border text-text-subtle hover:text-text"
                          }`}
                        >
                          {on ? "✓ " : ""}
                          {m.name || m.handle}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-subtle">{t("certs.noTeam")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
