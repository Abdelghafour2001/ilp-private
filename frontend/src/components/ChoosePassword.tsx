"use client";

/**
 * The screen a one-time password gets you to, and no further.
 *
 * Testers are opened in bulk: L&D sets a password and hands it over in a chat
 * thread, where it stays for ever. So a password somebody else chose is
 * treated as a key for one use — the account reaches this screen and nothing
 * else until its owner picks their own, at which point the handed-over string
 * stops working.
 *
 * Not a dialog that can be dismissed, and not a route that can be navigated
 * away from: AppShell renders this *instead of* the application.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

export default function ChoosePassword() {
  const { t } = useI18n();
  const [given, setGiven] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.changePassword({
        current_password: given,
        new_password: next,
        learner_id: getStoredLearner()?.id,
      });
      // The server has just voided every earlier session, this tab's included.
      localStorage.setItem("dqai.token", r.token);
      localStorage.removeItem("dqai.must_change_password");
      // A full load rather than a state flip: the gate is read at mount, and
      // this is the one moment the answer changes.
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border p-6">
        <h1 className="text-xl font-semibold">{t("pwd.first.title")}</h1>
        <p className="text-sm text-text-subtle">{t("pwd.first.lede")}</p>
        <input
          className="input w-full"
          type="password"
          autoComplete="current-password"
          placeholder={t("pwd.first.given")}
          value={given}
          onChange={(e) => setGiven(e.target.value)}
        />
        <input
          className="input w-full"
          type="password"
          autoComplete="new-password"
          placeholder={t("pwd.new")}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button
          className="btn w-full"
          disabled={busy || !given || next.length < 12}
          onClick={submit}
        >
          {busy ? t("pwd.first.done") : t("pwd.change")}
        </button>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
