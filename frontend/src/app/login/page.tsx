"use client";

/**
 * /login — the front door. Microsoft SSO is the primary path when Azure is
 * configured; the lightweight handle login stays available as a demo fallback.
 * Signed-in visitors are bounced straight back to the app.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Icon from "@/components/Icon";
import { api, type LearnerRole } from "@/lib/api";
import { authConfig, type AuthConfig, ssoError, ssoLogin } from "@/lib/auth";
import { claimHandle, getStoredLearner, storeLearner } from "@/lib/learner";

function LoginInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  // What this server actually offers. Null while we are asking: showing a
  // password box that turns out to be refused is worse than a moment's wait.
  const [ways, setWays] = useState<AuthConfig | null>(null);
  const [handle, setHandle] = useState("");
  const [showHandle, setShowHandle] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getStoredLearner()) {
      router.replace(next);
      return;
    }
    authConfig()
      .then(setWays)
      .catch(() => setWays({ enabled: false, client_id: "", tenant_id: "", authority: "",
                             password_login: false, sso_redirect: false, handle_login: true }));
  }, [router, next]);

  // Microsoft refused, or the person declined consent: the callback sends them
  // back here saying why instead of to a form that looks like it did nothing.
  useEffect(() => {
    const refused = params.get("sso_error");
    if (refused) setError(refused);
  }, [params]);

  // Finish a server-side SSO sign-in. The callback lands on this page with the
  // session token in the URL fragment, which is why this page and not the one
  // the person was heading for.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("sso_token");
    if (!token) return;
    localStorage.setItem("dqai.token", token);
    // Out of the address bar before it can be copied, shared or bookmarked.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    api
      .authMe()
      .then((me) => {
        localStorage.setItem("dqai.is_admin", me.is_admin ? "1" : "");
        storeLearner({
          id: me.learner_id,
          handle: me.handle,
          name: me.name ?? null,
          xp: me.xp ?? 0,
          role: me.role,
          onboarded: me.onboarded,
        });
        router.replace(next);
      })
      .catch((e) => setError((e as Error).message));
  }, [router, next]);

  async function withPassword() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const me = await api.login(email.trim(), password);
      // The same key the SSO path writes, so every request is authorised the
      // same way whichever door the person came through.
      localStorage.setItem("dqai.token", me.token);
      localStorage.setItem("dqai.is_admin", me.role === "admin" ? "1" : "");
      // A password set by L&D gets them to one screen only. AppShell reads this.
      localStorage.setItem("dqai.must_change_password", me.must_change_password ? "1" : "");
      storeLearner({
        id: me.learner_id,
        handle: me.handle,
        name: me.name ?? null,
        xp: 0,
        role: me.role as LearnerRole,
        onboarded: me.onboarded,
      });
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function microsoft() {
    // Server-side flow: leave the page. Nothing to initialise, no popup to be
    // blocked, and the server does the token exchange with its own secret.
    if (ways?.sso_redirect) {
      window.location.href = `/api/auth/sso/azure?next=${encodeURIComponent(next)}`;
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await ssoLogin();
      if (!token) {
        // Show what actually failed. Entra names the problem precisely
        // (AADSTS50011 for an unregistered redirect URI, for instance), and
        // a generic "network problem" sends people looking in the wrong place.
        setError(ssoError() || "Connexion Microsoft impossible.");
        setShowHandle(true);
        return;
      }
      const me = await api.authMe();
      localStorage.setItem("dqai.is_admin", me.is_admin ? "1" : "");
      storeLearner({
        id: me.learner_id,
        handle: me.handle,
        name: me.name ?? null,
        xp: me.xp ?? 0,
        role: me.role,
        onboarded: me.onboarded,
      });
      router.replace(next);
    } catch (e) {
      setError(ssoError() || (e as Error).message || t("login.ssoCancelled"));
    } finally {
      setBusy(false);
    }
  }

  async function withHandle() {
    if (handle.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await claimHandle(handle);
      router.replace(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] bg-bg lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ---- Left: what this is, shown rather than told ------------------ */}
      <aside
        className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
        aria-hidden="true"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: "radial-gradient(rgb(var(--border-strong)) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse 80% 70% at 70% 60%, black 20%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 70% 60%, black 20%, transparent 75%)",
          }}
        />
        <Brand />

        <div className="relative">
          <p className="max-w-[16ch] text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-text xl:text-6xl">
            Apprendre en <span className="text-accent-text">faisant</span>.
          </p>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-text-muted">
            Trainings, parcours, compétences et certifications au même endroit. Votre manager et
            les RH suivent la progression en temps réel.
          </p>
        </div>

        {/* A still life of the product: three fragments of real screens. */}
        <div className="relative h-56 select-none">
          <div className="absolute left-0 top-6 w-72 -rotate-[3deg]">
            <div className="animate-fade-up rounded-xl border border-border bg-surface p-4 shadow-lg [animation-delay:120ms]">
            <div className="flex items-center gap-3">
              <span className="relative grid h-12 w-12 place-items-center">
                <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                  <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" className="stroke-surface-3" />
                  <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-accent" strokeDasharray="94 126" />
                </svg>
                <span className="text-xs font-semibold tnum">75%</span>
              </span>
              <div>
                <p className="text-sm font-medium">Objectif de la semaine</p>
                <p className="text-xs text-text-subtle tnum">45 sur 60 min</p>
              </div>
            </div>
            </div>
          </div>
          <div className="absolute left-60 top-0 w-64 rotate-[2deg]">
            <div className="animate-fade-up rounded-xl border border-border bg-surface p-4 shadow-xl [animation-delay:220ms]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-border leading-none">
                <span className="text-[9px] font-semibold uppercase text-bad">oct</span>
                <span className="mt-0.5 text-sm font-semibold tnum">12</span>
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Kickoff — cohorte 2</p>
                <p className="text-xs text-text-subtle">lun. · 08:30 · Salle Atlas</p>
              </div>
            </div>
            </div>
          </div>
          <div className="absolute left-28 top-32 w-80 -rotate-[1deg]">
            <div className="animate-fade-up rounded-xl border border-border bg-surface p-4 shadow-lg [animation-delay:320ms]">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">SQL en 1 heure</p>
              <span className="text-xs text-text-subtle tnum">4/6</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full w-2/3 rounded-full bg-accent" />
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-good">
              <Icon name="check" size={12} /> Quête « Query master » terminée
            </p>
            </div>
          </div>
        </div>
      </aside>

      {/* ---- Right: the door ------------------------------------------- */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Connexion</h1>
          <p className="mt-1.5 text-sm text-text-muted">
            Accédez à vos formations, parcours et certifications.
          </p>

          <div className="mt-8 space-y-4">
            {ways === null ? (
              <div className="space-y-3" aria-busy="true">
                <div className="h-11 skeleton rounded-lg" />
                <div className="h-11 skeleton rounded-lg" />
              </div>
            ) : (
              <>
                {(ways.enabled || ways.sso_redirect) && (
                  <button
                    className="btn-ghost w-full justify-center py-2.5 text-text"
                    disabled={busy}
                    onClick={microsoft}
                  >
                    {/* Microsoft logo squares */}
                    <span className="mr-1 grid grid-cols-2 gap-[2px]" aria-hidden>
                      <span className="h-2 w-2 bg-[#F25022]" />
                      <span className="h-2 w-2 bg-[#7FBA00]" />
                      <span className="h-2 w-2 bg-[#00A4EF]" />
                      <span className="h-2 w-2 bg-[#FFB900]" />
                    </span>
                    {busy ? "Connexion…" : "Continuer avec Microsoft"}
                  </button>
                )}

                {/* Email + password. Offered beside SSO rather than instead of it:
                    externals and anyone without an Entra account need a door. */}
                {ways.password_login && (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      withPassword();
                    }}
                  >
                    {ways.enabled && <Divider>{t("login.orWithPassword")}</Divider>}
                    <div>
                      <label htmlFor="login-email" className="label">E-mail</label>
                      <input
                        id="login-email"
                        name="email"
                        autoFocus={!ways.enabled}
                        className="input py-2.5"
                        type="email"
                        autoComplete="username"
                        spellCheck={false}
                        placeholder="prenom.nom@teal.ma"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="login-password" className="label">{t("login.password")}</label>
                      <input
                        id="login-password"
                        name="password"
                        className="input py-2.5"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn w-full justify-center py-2.5"
                      disabled={busy || !email.trim() || !password}
                    >
                      {busy ? t("login.signingIn") : t("login.signIn")}
                    </button>
                    <p className="text-center text-xs text-text-subtle">{t("login.forgot")}</p>
                  </form>
                )}

                {ways.enabled && ways.handle_login && !showHandle && (
                  <button
                    className="w-full text-center text-xs text-text-subtle hover:text-text"
                    onClick={() => setShowHandle(true)}
                  >
                    ou continuer avec un pseudo (mode démo) →
                  </button>
                )}

                {ways.handle_login && (!ways.enabled || showHandle) && (
                  <div className="space-y-2">
                    {ways.enabled ? (
                      <Divider>mode démo</Divider>
                    ) : (
                      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-muted">
                        SSO Microsoft non configuré sur cet environnement — connexion par pseudo.
                      </p>
                    )}
                    <label htmlFor="login-handle" className="label pt-1">Pseudo</label>
                    <div className="flex gap-2">
                      <input
                        id="login-handle"
                        name="handle"
                        autoFocus={!ways.enabled}
                        className="input flex-1 py-2.5"
                        autoComplete="username"
                        spellCheck={false}
                        placeholder="ton.pseudo"
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && withHandle()}
                      />
                      <button className="btn px-4" disabled={busy || handle.trim().length < 2} onClick={withHandle}>
                        Entrer
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          <p className="mt-10 flex items-start gap-2 border-t border-border pt-5 text-xs leading-relaxed text-text-subtle">
            <Icon name="sparkles" size={14} aria-hidden="true" className="mt-px shrink-0 text-accent-text" />
            Première connexion ? Un rapide questionnaire vous proposera le parcours adapté.
          </p>
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="relative flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/teal-logo-green.png" alt="Teal" width={41} height={40} className="h-10 w-auto rounded-lg dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/teal-logo-white.png" alt="Teal" width={41} height={40} className="hidden h-10 w-auto dark:block" />
      <span className="h-6 w-px bg-border" aria-hidden="true" />
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-text">UpSkill</span>
        <span className="block text-[11px] uppercase tracking-[0.14em] text-text-subtle">Learning</span>
      </span>
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-text-subtle">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
