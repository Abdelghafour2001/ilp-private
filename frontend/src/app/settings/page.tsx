"use client";

/**
 * Account & settings — who the platform thinks you are, and the few things
 * you are allowed to change about that.
 *
 * The org axes (BU, practice, team, title, grade) are shown but read-only:
 * they decide which HR perimeter you fall into, so editing your own would move
 * you between them. They are displayed anyway, because the fastest way to find
 * a wrong BU is to let the person it belongs to look at it.
 */

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { api, type Account, type SessionInfo } from "@/lib/api";
import { getStoredLearner, clearLearner } from "@/lib/learner";
import { signOutEverywhere } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import Field, { Segmented } from "@/components/form/Field";
import PasswordPanel from "@/components/PasswordPanel";

function initials(name: string, handle: string) {
  const source = (name || handle).replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((source[0]?.[0] ?? "") + (source[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** A read-only fact about this account. */
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-text">{value || "—"}</dd>
      {hint && <dd className="mt-0.5 text-xs text-text-subtle">{hint}</dd>}
    </div>
  );
}

/** One settings block: what it is on the left, the controls on the right. */
function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-t border-border py-8 first:border-t-0 first:pt-0 md:grid-cols-[15rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {lede && <p className="mt-1 text-sm leading-relaxed text-text-muted">{lede}</p>}
      </div>
      <div className="panel p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, set: setTheme } = useTheme();
  const [account, setAccount] = useState<Account | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(0);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const stored = getStoredLearner();
    api
      .account(stored?.id)
      .then((a) => {
        setAccount(a);
        setName(a.name);
        setGoal(a.weekly_goal_min);
      })
      .catch((e) => setError(String(e.message ?? e)));
    api.accountSession(stored?.id).then(setSession).catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function save(patch: { name?: string; locale?: "fr" | "en"; weekly_goal_min?: number }) {
    setBusy(true);
    setError("");
    try {
      const stored = getStoredLearner();
      const next = await api.updateAccount(patch, stored?.id);
      setAccount(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      // Keep the UI language and the stored preference in step: the server
      // copy decides what language the emails are written in.
      if (patch.locale) setLocale(patch.locale);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await signOutEverywhere();
  }

  if (error && !account) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("settings.title")}</h1>
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
        <p className="text-sm text-text-subtle">{t("settings.signInFirst")}</p>
      </div>
    );
  }

  if (!account)
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-9 w-64 skeleton" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 skeleton rounded-xl" />
        ))}
      </div>
    );

  const viaAzure = account.sign_in === "azure";
  // A password account is neither Entra nor the demo handle, and the page was
  // telling these people they had no password directly above the form that
  // changes it.
  const viaPassword = account.sign_in === "password";
  const lang = locale as "fr" | "en";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-5">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent text-xl font-semibold text-accent-fg" aria-hidden="true">
          {initials(account.name, account.handle)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("settings.title")}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <span className="font-medium text-text">{account.name || account.handle}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{account.email || t("settings.noEmail")}</span>
            <span className="badge badge-accent">{t(`role.${account.role}`, account.role_label)}</span>
          </p>
        </div>
        {/* Saves happen on change; this is where the page says so. */}
        <p aria-live="polite" className="text-sm">
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-good">
              <Icon name="check" size={14} /> {t("settings.saved")}
            </span>
          )}
          {busy && !saved && <span className="text-text-subtle">{t("set.saving")}</span>}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      <div>
        <Section title={t("set.profile")} lede={t("set.profileLede")}>
          <div className="space-y-5">
            <Field id="set-name" label={t("settings.displayName")} hint={t("settings.displayNameHint")}>
              <input
                id="set-name"
                className="input max-w-md"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== account.name && save({ name: name.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                disabled={busy}
              />
            </Field>
            <dl className="grid gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3">
              <Fact label={t("settings.email")} value={account.email} hint={viaAzure ? t("settings.emailFromEntra") : t("settings.emailLocal")} />
              <Fact label={t("settings.handle")} value={account.handle} hint={t("settings.handleHint")} />
              <Fact label={t("settings.xp")} value={String(account.xp)} />
            </dl>
          </div>
        </Section>

        <Section title={t("settings.preferences")} lede={t("set.prefsLede")}>
          <div className="space-y-6">
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("settings.language")}</p>
              <Segmented
                label={t("settings.language")}
                value={lang}
                onChange={(code) => !busy && code !== lang && save({ locale: code })}
                options={[
                  { value: "fr" as const, label: "Français" },
                  { value: "en" as const, label: "English" },
                ]}
              />
              <p className="mt-1.5 text-xs text-text-subtle">{t("settings.languageHint")}</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("set.appearance")}</p>
              <Segmented
                label={t("set.appearance")}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light" as const, label: <span className="inline-flex items-center gap-1.5"><Icon name="sun" size={13} /> {t("set.light")}</span> },
                  { value: "dark" as const, label: <span className="inline-flex items-center gap-1.5"><Icon name="moon" size={13} /> {t("set.dark")}</span> },
                ]}
              />
              <p className="mt-1.5 text-xs text-text-subtle">{t("set.appearanceHint")}</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("settings.weeklyGoal")}</p>
              <Segmented
                label={t("settings.weeklyGoal")}
                value={String(goal)}
                onChange={(v) => {
                  if (busy) return;
                  setGoal(Number(v));
                  save({ weekly_goal_min: Number(v) });
                }}
                options={[0, 15, 30, 60, 120].map((m) => ({
                  value: String(m),
                  label: m === 0 ? t("settings.noGoal") : `${m} min`,
                }))}
              />
              <p className="mt-1.5 text-xs text-text-subtle">{t("set.goalHint")}</p>
            </div>
          </div>
        </Section>

        <Section title={t("set.security")} lede={t("set.securityLede")}>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${viaAzure || viaPassword ? "bg-good/10 text-good" : "bg-surface-3 text-text-muted"}`}>
                <Icon name={viaAzure || viaPassword ? "lock" : "team"} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {viaAzure ? t("settings.viaMicrosoft") : viaPassword ? t("settings.viaPassword") : t("settings.viaHandle")}
                </p>
                <p className="text-xs text-text-subtle">
                  {account.sso_available ? t("settings.ssoOn") : t("settings.ssoOff")}
                </p>
              </div>
              {session?.token_valid && (
                <span className="inline-flex items-center gap-1 text-xs text-good">
                  <Icon name="check" size={12} /> {t("settings.tokenValid")}
                </span>
              )}
            </div>
            <dl className="border-t border-border pt-5">
              <Fact
                label={t("settings.password")}
                value={viaAzure ? t("settings.passwordEntra") : viaPassword ? t("settings.passwordSet") : t("settings.passwordNone")}
                hint={viaAzure ? t("settings.passwordEntraHint") : viaPassword ? t("settings.passwordSetHint") : t("settings.passwordNoneHint")}
              />
            </dl>

            {/* Somebody who signs in with a password changes it here; somebody who
                signs in with Microsoft changes it at Microsoft. Never both. */}
            {viaPassword && <PasswordPanel />}

            {viaAzure && (
              <a
                className="btn-ghost btn-sm w-fit"
                href="https://myaccount.microsoft.com/security-info"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("settings.managePassword")} <Icon name="external" size={12} />
              </a>
            )}
          </div>
        </Section>

        <Section title={t("settings.org")} lede={t("settings.orgHint")}>
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t("settings.bu")} value={account.bu} />
            <Fact label={t("common.practice")} value={account.practice} />
            <Fact label={t("common.team")} value={account.team} />
            <Fact label={t("common.title")} value={account.title} />
            <Fact label={t("common.site")} value={account.location} />
            <Fact label={t("common.matricule")} value={account.matricule} />
          </dl>
        </Section>

        <Section title={t("set.session")} lede={t("set.sessionLede")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">{t("set.signOutHint")}</p>
            <button type="button" className="btn-ghost text-bad hover:bg-bad/10" onClick={signOut}>
              <Icon name="logout" size={15} /> {t("settings.signOut")}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
