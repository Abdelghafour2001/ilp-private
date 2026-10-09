// Azure Entra ID SSO via MSAL.
//
// This used to load MSAL from Microsoft's CDN at runtime so the app would
// build without the npm package. That trade turned out to be the wrong way
// round: `alcdn.msauth.net/browser/<version>/js/msal-browser.min.js` now 404s
// for every version, the loader failed *soft* by design, and the result was a
// "Sign in with Microsoft" button that did nothing at all and logged nothing.
// A build-time dependency cannot disappear from under a running deployment,
// so MSAL is now a normal import.
//
// SSO still only activates when the server reports it is configured; otherwise
// the app falls back to handle sign-in and MSAL is never initialised.

import type { IPublicClientApplication } from "@azure/msal-browser";

export interface AuthConfig {
  /** Entra SSO is configured on this server. */
  enabled: boolean;
  client_id: string;
  tenant_id: string;
  authority: string;
  /** Email + password sign-in is accepted. Can be on at the same time as SSO:
   *  externals have no Entra account. */
  password_login: boolean;
  /** The server runs the Entra code flow itself: the page navigates to
   *  /api/auth/sso/azure instead of loading MSAL. Preferred when both are on —
   *  it needs nothing of the tenant in the browser. */
  sso_redirect: boolean;
  /** Neither is configured — a local demo, where the handle box is the door.
   *  Server-decided, so a deployed instance can never show that box. */
  handle_login: boolean;
}

let configCache: AuthConfig | null = null;
let msal: IPublicClientApplication | null = null;
let initPromise: Promise<IPublicClientApplication | null> | null = null;

/** The last thing that went wrong, for the UI to show instead of staying mute. */
let lastError = "";

export function ssoError(): string {
  return lastError;
}

export async function authConfig(): Promise<AuthConfig> {
  if (!configCache) {
    configCache = await fetch("/api/auth/config").then((r) => r.json());
  }
  return configCache!;
}

async function getMsal(): Promise<IPublicClientApplication | null> {
  if (msal) return msal;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cfg = await authConfig();
    if (!cfg.enabled) {
      lastError = "Single sign-on is not configured on this server.";
      return null;
    }
    try {
      // Imported lazily so the bundle only pays for MSAL on a page that signs
      // in, and so a broken install surfaces here rather than at module load.
      const { PublicClientApplication } = await import("@azure/msal-browser");
      const app = new PublicClientApplication({
        auth: {
          clientId: cfg.client_id,
          authority: cfg.authority,
          // Must match a *Single-page application* redirect URI registered on
          // the app registration — the origin only, no path.
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: "localStorage" },
      });
      await app.initialize();
      // Settles any interaction left hanging by a previous load, so the
      // interaction lock below is only ever a genuinely stale one.
      await app.handleRedirectPromise().catch(() => null);
      msal = app;
      lastError = "";
      return app;
    } catch (e) {
      lastError = `Could not start Microsoft sign-in: ${(e as Error).message}`;
      initPromise = null; // let a later attempt retry
      return null;
    }
  })();

  return initPromise;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("dqai.token");
}

export function isAdmin(): boolean {
  return typeof window !== "undefined" && localStorage.getItem("dqai.is_admin") === "1";
}

/** Drop MSAL's interaction lock.
 *
 * A popup that dies mid-flight — a redirect-URI mismatch renders Microsoft's
 * error page *inside* the popup, and the user closes it — leaves the lock set.
 * MSAL then refuses every later attempt with `interaction_in_progress` without
 * contacting Microsoft, so the button stays dead even once the underlying
 * problem is fixed. There is no public API to release it; the key is the
 * documented remedy.
 */
function clearInteractionLock() {
  for (const store of [sessionStorage, localStorage]) {
    for (const key of Object.keys(store)) {
      if (key.includes("interaction.status")) store.removeItem(key);
    }
  }
}

export async function ssoLogin(): Promise<string | null> {
  const app = await getMsal();
  if (!app) return null;
  try {
    let res;
    try {
      res = await app.loginPopup({ scopes: ["openid", "profile", "email"] });
    } catch (e) {
      // Retry once, and only for the stale lock: anything else is a real
      // failure and retrying it would just double the popups.
      if (!/interaction_in_progress/i.test((e as Error).message ?? "")) throw e;
      clearInteractionLock();
      res = await app.loginPopup({ scopes: ["openid", "profile", "email"] });
    }
    if (res.idToken) {
      localStorage.setItem("dqai.token", res.idToken);
      lastError = "";
      return res.idToken;
    }
    lastError = "Microsoft returned no ID token.";
    return null;
  } catch (e) {
    // Entra's own errors land here — a redirect URI that is not registered
    // reads as AADSTS50011, and that is worth showing verbatim rather than
    // swallowing, because it names the exact thing to fix.
    const message = (e as Error).message ?? String(e);
    lastError = /user_cancelled|popup_window_error|user_canceled/i.test(message)
      ? "Sign-in was cancelled."
      : message;
    return null;
  }
}

export async function ssoLogout() {
  localStorage.removeItem("dqai.token");
  localStorage.removeItem("dqai.is_admin");
  const app = await getMsal();
  if (app) {
    try {
      await app.logoutPopup();
    } catch {
      /* popup closed — already cleared locally */
    }
  }
}

/** Everything this browser knows about who was signed in. */
const SESSION_KEYS = [
  "dqai.learner",
  "dqai.token",
  "dqai.is_admin",
  // The platform admin token, if somebody pasted one into the admin screens.
  // Leaving it behind on a shared machine hands the next person the keys.
  "dqai.adminToken",
  // Whose password is whose: left behind, it would gate the next person to
  // sign in on this browser on a password that is not theirs.
  "dqai.must_change_password",
];

/**
 * Sign out of everything, here and now.
 *
 * It used to clear only the learner, and only clear the token when the person
 * had come in through SSO — so a password user pressed "Sign out", the
 * interface went blank, and the bearer token stayed in localStorage. The next
 * click sent it again and the app answered with whatever error the screen felt
 * like showing.
 *
 * So: every key goes, the module caches go, MSAL is told when it is involved,
 * and the last step is a *full page load* rather than a router push. A router
 * push keeps React state, in-flight requests and anything a component cached
 * in a closure; a reload is the only way to be sure none of it survives.
 */
export async function signOutEverywhere() {
  try {
    if (configCache?.enabled) await ssoLogout();
  } catch {
    /* the local half below is what matters */
  }
  for (const key of SESSION_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode: nothing was stored anyway */
    }
  }
  // Module-level caches, which a reload would clear anyway but which must not
  // be read by anything running between here and the navigation.
  configCache = null;
  msal = null;
  initPromise = null;
  window.location.replace("/login");
}
