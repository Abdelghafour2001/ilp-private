"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import LevelRing from "@/components/LevelRing";
import SkillTree from "@/components/SkillTree";
import GoalsPanel from "@/components/GoalsPanel";
import QuestList from "@/components/QuestList";
import { api, type Badge, type EarnedCertificate, type LearnerProfile } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import AchievementBadge, { tierFor } from "@/components/AchievementBadge";
import ExpiryBadge from "@/components/ExpiryBadge";
import { useT } from "@/lib/i18n";

function initials(handle: string) {
  const p = handle.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || handle.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function fmtDate(d: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ProfilePage() {
  const t = useT();
  const [learnerId, setLearnerId] = useState<number | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [catalog, setCatalog] = useState<Badge[]>([]);
  const [certificates, setCertificates] = useState<EarnedCertificate[]>([]);

  useEffect(() => {
    const learner = getStoredLearner();
    setLearnerId(learner?.id ?? null);
    api.badges().then(setCatalog).catch(() => setCatalog([]));
    if (learner) {
      api.learnerProfile(learner.id, learner.id).then(setProfile).catch(() => setProfile(null));
      api
        .certFeed()
        .then((feed) => setCertificates(feed.filter((c) => c.learner_id === learner.id)))
        .catch(() => setCertificates([]));
    }
    const onChange = () => {
      const l = getStoredLearner();
      if (l) {
        api.learnerProfile(l.id, l.id).then(setProfile).catch(() => {});
        api
          .certFeed()
          .then((feed) => setCertificates(feed.filter((c) => c.learner_id === l.id)))
          .catch(() => setCertificates([]));
      }
    };
    window.addEventListener("dqai-learner-changed", onChange);
    return () => window.removeEventListener("dqai-learner-changed", onChange);
  }, []);

  if (!learnerId) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent-text">
          <Icon name="bolt" size={22} />
        </span>
        <h1 className="mt-4 text-xl font-semibold">{t("profile.signIn")}</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          {t("profile.signInHint")}
        </p>
        <Link href="/labs" className="btn mt-5">
          {t("profile.exploreLabs")}
        </Link>
      </div>
    );
  }

  const earned = new Set(profile?.badges ?? []);

  return (
    <div className="space-y-8">
      {/* ---- Hero ------------------------------------------------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl bg-accent-sheen text-2xl font-bold text-white shadow-glow">
            {profile ? initials(profile.name || profile.handle) : "··"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {profile?.name || profile?.handle || "…"}
            </h1>
            <p className="mt-0.5 text-sm font-medium text-accent-text">
              {profile?.level_title ?? "Novice"} · Level {profile?.level ?? 1}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="chip">
                <Icon name="bolt" size={13} className="text-accent-text" />
                <span className="font-mono tnum">{profile?.xp ?? 0}</span> XP
              </span>
              <span className="chip">
                <Icon name="flame" size={13} className="text-warn" />
                <span className="font-mono tnum">{profile?.current_streak ?? 0}</span> {t("profile.dayStreak")}
              </span>
              <span className="chip">
                <Icon name="trophy" size={13} className="text-iris" />
                <span className="font-mono tnum">{earned.size}</span> badges
              </span>
              {(profile?.longest_streak ?? 0) > 0 && (
                <span className="chip">
                  {t("profile.bestStreak")} <span className="font-mono tnum">{profile?.longest_streak}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <LevelRing level={profile?.level ?? 1} pct={profile?.level_pct ?? 0} size={84} />
            <p className="text-[11px] text-text-subtle">
              {profile?.xp_to_next ?? 0} XP to level {(profile?.level ?? 1) + 1}
            </p>
          </div>
        </div>
      </section>

      {(profile?.bu || profile?.practice || profile?.location || profile?.matricule) && (
        <section className="panel p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-subtle">
            {t("profile.org")}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "BU", value: profile?.bu },
              { label: "Practice", value: profile?.practice },
              { label: "Location", value: profile?.location },
              ...(profile?.matricule != null
                ? [{ label: t("common.matricule"), value: profile.matricule }]
                : []),
            ]
              .filter((f) => f.value)
              .map((f) => (
                <div key={f.label}>
                  <dt className="text-xs text-text-subtle">{f.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{f.value}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {/* Goals first: the skill tree says where you are, this says where
              you are going, and the second is what people come here for. */}
          <GoalsPanel learnerId={learnerId} />

          {/* Skill tree. Skills left the main menu and live here now, so the
              way through to rating them has to be on this page. */}
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("profile.skillTree")}</h2>
              <Link href="/skills" className="text-sm text-accent hover:underline">
                {t("profile.skillsLink")}
              </Link>
            </div>
            <SkillTree learnerId={learnerId} />
          </section>
        </div>

        <div className="space-y-8">
          {/* Badges */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("profile.badges")}</h2>
              <span className="text-sm text-text-subtle">
                {earned.size}/{catalog.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {catalog.map((b) => {
                const has = earned.has(b.id);
                return (
                  <div
                    key={b.id}
                    className={[
                      "flex items-center justify-center rounded-xl border p-2.5 transition",
                      has ? "border-border bg-surface-2" : "border-dashed border-border bg-transparent",
                    ].join(" ")}
                  >
                    <AchievementBadge
                      emoji={b.emoji}
                      label={b.name}
                      tier={tierFor(b.id)}
                      locked={!has}
                      size={64}
                      title={`${b.name} — ${b.description}`}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Certifications */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("certs.title")}</h2>
              <Link href="/certifications" className="text-xs text-accent hover:underline">
                {t("profile.shareOne")}
              </Link>
            </div>
            <div className="panel divide-y divide-border overflow-hidden">
              {certificates.length === 0 ? (
                <p className="p-5 text-center text-sm text-text-subtle">
                  No certificates shared yet —{" "}
                  <Link href="/certifications" className="text-accent hover:underline">
                    {t("profile.shareFirst")}
                  </Link>
                  .
                </p>
              ) : (
                certificates.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-3.5">
                    <span className="text-xl leading-none">🏅</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text">
                        {c.title}
                        <span className="ml-2 inline-flex align-middle">
                          <ExpiryBadge expiresOn={c.expires_on} />
                        </span>
                      </p>
                      {c.issuer && <p className="text-xs text-text-subtle">{c.issuer}</p>}
                      <p className="mt-0.5 text-xs text-text-subtle">
                        {c.obtained_on ? fmtDate(c.obtained_on) : fmtDate(c.created_at)}
                        {c.expires_on && (
                          <span> · valide jusqu&apos;au {fmtDate(c.expires_on)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Weekly quests */}
          <QuestList compact />

          {/* Recent activity */}
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t("profile.recent")}</h2>
            <div className="panel divide-y divide-border overflow-hidden">
              {!profile ? (
                [...Array(4)].map((_, i) => <div key={i} className="h-12 skeleton" />)
              ) : profile.recent.length === 0 ? (
                <p className="p-5 text-center text-sm text-text-subtle">
                  {t("profile.noActivity")}
                </p>
              ) : (
                profile.recent.map((r, i) => (
                  <Link
                    key={i}
                    href={`/labs/${r.lab_id}`}
                    className="flex items-center gap-3 p-3.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-good/10 text-good">
                      <Icon name="check" size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{r.step_title}</span>
                      <span className="truncate text-xs text-text-subtle">{r.lab_title}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      {r.xp > 0 && <span className="block font-mono text-xs text-accent-text">+{r.xp}</span>}
                      <span className="text-[11px] text-text-subtle">{timeAgo(r.at)}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
