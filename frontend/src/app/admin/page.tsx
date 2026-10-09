"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { api, type AdminStats } from "@/lib/api";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import { getStoredLearner } from "@/lib/learner";
import Switchboard from "@/components/Switchboard";

export default function AdminDashboard() {
  const t = useT();
  const [stats, setStats] = useState<AdminStats | null>(null);
  // Platform administration is narrower than governance: roles, labs,
  // integrations, deletions. Running the people is not running the app, so an
  // L&D lead lands on the governance console instead.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => setRole(getStoredLearner()?.role ?? null), []);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestMsg, setDigestMsg] = useState<string | null>(null);

  async function runDigest() {
    setDigestBusy(true);
    setDigestMsg(null);
    try {
      const r = await api.adminRunDigest(7);
      setDigestMsg(
        r.mail_enabled
          ? `✅ ${r.sent} e-mail(s) envoyé(s) · ${r.skipped_no_activity} sans activité cette semaine`
          : `⚠ ${t("admin.smtpOff")}`,
      );
    } catch (e) {
      setDigestMsg(String(e));
    } finally {
      setDigestBusy(false);
    }
  }

  useEffect(() => {
    setToken(localStorage.getItem("dqai.adminToken") ?? "");
    load();
  }, []);

  function load() {
    api
      .adminStats()
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }

  function saveToken() {
    localStorage.setItem("dqai.adminToken", token);
    load();
  }

  const cards = stats
    ? [
        ["Labs (visible)", stats.labs.total_visible],
        ["Courses", stats.courses],
        ["Challenges", stats.challenges],
        ["Sessions", stats.sessions],
        ["Stacks", stats.stacks],
        ["Assets", stats.assets],
        ["Learners", stats.learners],
        ["Completions", stats.completions],
        ["Badges awarded", stats.badges_awarded],
        ["Total XP", stats.total_xp],
        ["Tracks", stats.tracks.length],
      ]
    : [];

  if (role && role !== "admin") {
    return (
      <AccessDenied
        audience="access.audience.admin"
        detailKey="access.detail.admin"
        backHref="/admin/governance"
        backLabelKey="access.back.governance"
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-text-subtle">Manage labs, content, and learners.</p>
      </div>

      <Switchboard />

      <div className="card space-y-3">
        <h3 className="text-sm font-medium">Admin token</h3>
        <p className="text-xs text-text-subtle">
          Required only if <code>ADMIN_TOKEN</code> is set on the backend. Stored locally and sent
          as the <code>X-Admin-Token</code> header.
        </p>
        <div className="flex gap-2">
          <input
            className="input max-w-sm"
            type="password"
            placeholder="(leave blank if not configured)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn" onClick={saveToken}>
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-bad/40 text-sm text-bad">
          {error.includes("403") ? "Admin token required or invalid — set it above." : error}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {cards.map(([label, value]) => (
            <div key={label} className="card">
              <p className="text-2xl font-semibold text-accent">{value}</p>
              <p className="mt-1 text-xs text-text-subtle">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Link href="/admin/labs" className="btn">
          🧪 Manage labs
        </Link>
        <Link href="/admin/learners" className="btn-ghost">
          👥 Manage learners
        </Link>
        <Link href="/admin/coursera" className="btn-ghost">
          🎓 Coursera
        </Link>
      </div>

      {/* M-09 — weekly notification digest */}
      <div className="card space-y-2">
        <h3 className="text-sm font-medium">📧 Digest hebdomadaire</h3>
        <p className="text-xs text-text-subtle">
          Envoie à chaque collaborateur un résumé par e-mail de ses notifications des 7 derniers
          jours. À déclencher chaque lundi matin (un planificateur pourra l&apos;automatiser).
        </p>
        <div className="flex items-center gap-3">
          <button className="btn-soft" onClick={runDigest} disabled={digestBusy}>
            {digestBusy ? "Envoi en cours…" : "Envoyer le digest maintenant"}
          </button>
          {digestMsg && <span className="text-xs text-text-subtle">{digestMsg}</span>}
        </div>
      </div>
    </div>
  );
}
