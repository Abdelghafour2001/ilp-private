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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-4">
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-iris/10 blur-3xl" />

      <div className="relative w-full max-w-md space-y-6">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/teal-logo-green.png" alt="Teal" className="mx-auto mb-2 h-16 w-auto rounded-2xl dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/teal-logo-white.png" alt="Teal" className="mx-auto mb-2 hidden h-16 w-auto dark:block" />
          <p className="eyebrow mb-2">Learning &amp; development</p>
          <h1 className="text-4xl font-semibold tracking-tight">
            <span className="text-gradient">UpSkill</span>
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Trainings, parcours, compétences et certifications — apprends en faisant,
            ton manager et les RH suivent la progression en temps réel.
          </p>
        </div>

        <div className="card space-y-4 p-6 shadow-lg">
          {ways === null ? (
            <div className="h-11 skeleton rounded-xl" />
          ) : (
            <>
              {(ways.enabled || ways.sso_redirect) && (
                <button
                  className="btn w-full justify-center py-2.5"
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
                  {busy ? "Connexion…" : "Se connecter avec Microsoft"}
                </button>
              )}

              {/* Email + password. Offered beside SSO rather than instead of it:
                  externals and anyone without an Entra account need a door. */}
              {ways.password_login && (
                <div className="space-y-2">
                  {ways.enabled && (
                    <p className="text-center text-xs text-text-subtle">
                      {t("login.orWithPassword")}
                    </p>
                  )}
                  <input
                    autoFocus={!ways.enabled}
                    className="input w-full"
                    type="email"
                    autoComplete="username"
                    placeholder="prenom.nom@teal.ma"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <input
                    className="input w-full"
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("login.password")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && withPassword()}
                  />
                  <button
                    className="btn w-full justify-center py-2.5"
                    disabled={busy || !email.trim() || !password}
                    onClick={withPassword}
                  >
                    {busy ? t("login.signingIn") : t("login.signIn")}
                  </button>
                  <p className="text-center text-[11px] text-text-subtle">
                    {t("login.forgot")}
                  </p>
                </div>
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
                  {!ways.enabled && (
                    <p className="text-xs text-text-subtle">
                      SSO Microsoft non configuré sur cet environnement — connexion par pseudo :
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      autoFocus={!ways.enabled}
                      className="input flex-1"
                      placeholder="ton.pseudo"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && withHandle()}
                    />
                    <button className="btn-soft" disabled={busy || handle.trim().length < 2} onClick={withHandle}>
                      Entrer
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-bad">{error}</p>}
            </>
          )}
        </div>

        <p className="text-center text-xs text-text-subtle">
          <Icon name="admin" size={12} className="mr-1 inline" />
          Première connexion ? Un rapide questionnaire te proposera le parcours adapté.
        </p>
      </div>
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
