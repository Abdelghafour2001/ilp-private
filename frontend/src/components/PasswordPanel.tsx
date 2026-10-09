"use client";

/**
 * Change your own password.
 *
 * Only shown to accounts that have one — somebody who signs in through
 * Microsoft manages their password at Microsoft, and offering them a box here
 * would be offering them a second, useless credential.
 *
 * A successful change replaces the stored token, because the server has just
 * invalidated every session issued before it, including this tab's.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

export default function PasswordPanel() {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const r = await api.changePassword({
        current_password: current,
        new_password: next,
        learner_id: getStoredLearner()?.id,
      });
      localStorage.setItem("dqai.token", r.token);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-edge pt-3">
      <p className="text-xs uppercase tracking-wide text-text-subtle">{t("pwd.title")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[14rem]"
          type="password"
          autoComplete="current-password"
          placeholder={t("pwd.current")}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className="input max-w-[16rem]"
          type="password"
          autoComplete="new-password"
          placeholder={t("pwd.new")}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button className="btn btn-sm" disabled={busy || !current || next.length < 12} onClick={submit}>
          {t("pwd.change")}
        </button>
      </div>
      {done && <p className="text-sm text-good">{t("pwd.changed")}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
