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
import PasswordPanel from "@/components/PasswordPanel";

function initials(name: string, handle: string) {
  const source = (name || handle).replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((source[0]?.[0] ?? "") + (source[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** A read-only fact about this account. */
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <span className="text-xs uppercase tracking-wide text-text-subtle">{label}</span>
      <span className="text-sm text-text">{value || "—"}</span>
      {hint && <span className="text-xs text-text-subtle">{hint}</span>}
    </div>
  );
}

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
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
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="card text-sm text-bad">{error}</p>
        <p className="text-sm text-text-subtle">{t("settings.signInFirst")}</p>
      </div>
    );
  }

  if (!account) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  const viaAzure = account.sign_in === "azure";
  // A password account is neither Entra nor the demo handle, and the page was
  // telling these people they had no password directly above the form that
  // changes it.
  const viaPassword = account.sign_in === "password";

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="text-sm text-text-muted">{t("settings.lede")}</p>
      </header>

      {/* identity */}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent/15 text-lg font-semibold text-accent">
            {initials(account.name, account.handle)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{account.name || account.handle}</p>
            <p className="truncate text-sm text-text-muted">
              {account.email || t("settings.noEmail")}
            </p>
            <span className="badge mt-1 bg-accent/15 text-accent">{t(`role.${account.role}`, account.role_label)}</span>
          </div>
        </div>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1 py-2">
            <span className="text-xs uppercase tracking-wide text-text-subtle">
              {t("settings.displayName")}
            </span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== account.name && save({ name })}
              disabled={busy}
            />
            <span className="text-xs text-text-subtle">{t("settings.displayNameHint")}</span>
          </label>
          <Fact
            label={t("settings.email")}
            value={account.email}
            hint={viaAzure ? t("settings.emailFromEntra") : t("settings.emailLocal")}
          />
          <Fact
            label={t("settings.handle")}
            value={account.handle}
            hint={t("settings.handleHint")}
          />
          <Fact label={t("settings.xp")} value={String(account.xp)} />
        </div>
      </section>

      {/* sign-in */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t("settings.signIn")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`badge ${viaAzure || viaPassword ? "bg-good/15 text-good" : "bg-edge text-text-subtle"}`}
          >
            {viaAzure
              ? t("settings.viaMicrosoft")
              : viaPassword
                ? t("settings.viaPassword")
                : t("settings.viaHandle")}
          </span>
          {session?.token_valid && (
            <span className="badge bg-good/15 text-good">{t("settings.tokenValid")}</span>
          )}
        </div>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Fact
            label={t("settings.password")}
            value={
              viaAzure
                ? t("settings.passwordEntra")
                : viaPassword
                  ? t("settings.passwordSet")
                  : t("settings.passwordNone")
            }
            hint={
              viaAzure
                ? t("settings.passwordEntraHint")
                : viaPassword
                  ? t("settings.passwordSetHint")
                  : t("settings.passwordNoneHint")
            }
          />
          <Fact
            label={t("settings.method")}
            value={
              viaAzure
                ? "Microsoft Entra ID"
                : viaPassword
                  ? t("settings.viaPassword")
                  : t("settings.viaHandle")
            }
            hint={account.sso_available ? t("settings.ssoOn") : t("settings.ssoOff")}
          />
        </div>

        {/* Somebody who signs in with a password changes it here; somebody who
            signs in with Microsoft changes it at Microsoft. Never both. */}
        {viaPassword && <PasswordPanel />}

        {viaAzure && (
          <a
            className="btn-ghost btn-sm inline-flex w-fit items-center gap-1.5"
            href="https://myaccount.microsoft.com/security-info"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="admin" className="h-4 w-4" />
            {t("settings.managePassword")}
          </a>
        )}
      </section>

      {/* preferences */}
      <section className="card space-y-4">
        <h2 className="font-semibold">{t("settings.preferences")}</h2>

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-subtle">
            {t("settings.language")}
          </span>
          <div className="flex gap-2">
            {(["fr", "en"] as const).map((code) => (
              <button
                key={code}
                disabled={busy}
                onClick={() => save({ locale: code })}
                className={`badge transition ${
                  (account.locale ?? locale) === code
                    ? "badge-accent"
                    : "bg-edge text-text-subtle hover:text-text"
                }`}
              >
                {code === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
          <span className="text-xs text-text-subtle">{t("settings.languageHint")}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-text-subtle">
            {t("settings.weeklyGoal")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {[0, 15, 30, 60, 120].map((m) => (
              <button
                key={m}
                disabled={busy}
                onClick={() => {
                  setGoal(m);
                  save({ weekly_goal_min: m });
                }}
                className={`badge transition ${
                  goal === m ? "badge-accent" : "bg-edge text-text-subtle hover:text-text"
                }`}
              >
                {m === 0 ? t("settings.noGoal") : `${m} min`}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* org placement — read-only on purpose */}
      <section className="card space-y-2">
        <h2 className="font-semibold">{t("settings.org")}</h2>
        <p className="text-sm text-text-muted">{t("settings.orgHint")}</p>
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t("settings.bu")} value={account.bu} />
          <Fact label={t("common.practice")} value={account.practice} />
          <Fact label={t("common.team")} value={account.team} />
          <Fact label={t("common.title")} value={account.title} />
          <Fact label={t("common.site")} value={account.location} />
          <Fact label={t("common.matricule")} value={account.matricule} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={signOut}>
          {t("settings.signOut")}
        </button>
        {saved && <span className="text-sm text-good">{t("settings.saved")}</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
    </div>
  );
}
