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
import { useFormat, useI18n } from "@/lib/i18n";

function initials(handle: string) {
  const p = handle.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || handle.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string, locale: string) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (s < 3600) return rtf.format(-Math.max(1, Math.floor(s / 60)), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

export default function ProfilePage() {
  const { t, locale } = useI18n();
  const format = useFormat();
  const fmtDate = (d: string | null) => (d ? format.date(d, { day: "numeric", month: "short", year: "numeric" }) : "");
  const [allActivity, setAllActivity] = useState(false);
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
  // Earned first, then the rest: the shelf should open on what you have.
  const shelf = [...catalog].sort((x, y) => Number(earned.has(y.id)) - Number(earned.has(x.id)));
  const org = [profile?.bu, profile?.practice, profile?.location].filter(Boolean).join(" · ");
  const recent = profile?.recent ?? [];
  const shownActivity = allActivity ? recent : recent.slice(0, 6);

  return (
    <div className="space-y-10">
      {/* ---- Who, and how far ---------------------------------------------- */}
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 items-center gap-5">
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-accent text-2xl font-semibold text-accent-fg shadow-sm" aria-hidden="true">
            {profile ? initials(profile.name || profile.handle) : "··"}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-[-0.03em]">{profile?.name || profile?.handle || "…"}</h1>
            <p className="mt-1 text-sm font-medium text-accent-text">
              {t("profile.levelLine", { title: profile?.level_title ?? "Novice", level: profile?.level ?? 1 })}
            </p>
            {(org || profile?.matricule) && (
              <p className="mt-1.5 text-sm text-text-muted">
                {org}
                {profile?.matricule && (
                  <span className="text-text-subtle">
                    {org ? " · " : ""}
                    {t("common.matricule")} {profile.matricule}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center gap-4 p-5">
            <LevelRing level={profile?.level ?? 1} pct={profile?.level_pct ?? 0} label={t("home.lvl")} />
            <div className="min-w-0">
              <p className="font-semibold">{profile?.level_title ?? "Novice"}</p>
              <p className="mt-0.5 text-sm text-text-muted tnum">
                {t("home.progress.toNext", { xp: profile?.xp_to_next ?? 0, level: (profile?.level ?? 1) + 1 })}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-4 divide-x divide-border border-t border-border bg-surface-2/60 text-center">
            {[
              { k: "XP", v: format.number(profile?.xp ?? 0), icon: "bolt" as const, tone: "text-iris" },
              { k: t("profile.streakShort"), v: profile?.current_streak ?? 0, icon: "flame" as const, tone: "text-warn" },
              { k: t("profile.bestShort"), v: profile?.longest_streak ?? 0, icon: "trophy" as const, tone: "text-text-subtle" },
              { k: t("profile.badges"), v: earned.size, icon: "award" as const, tone: "text-good" },
            ].map((x) => (
              <div key={x.k} className="px-2 py-3">
                <dt className="flex items-center justify-center gap-1 text-[11px] text-text-subtle">
                  <Icon name={x.icon} size={11} className={x.tone} /> {x.k}
                </dt>
                <dd className="mt-0.5 font-semibold tnum">{x.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {/* Goals first: the skill tree says where you are, this says where
              you are going, and the second is what people come here for. */}
          <GoalsPanel learnerId={learnerId} />

          {/* Skill tree. Skills left the main menu and live here now, so the
              way through to rating them has to be on this page. */}
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{t("profile.skillTree")}</h2>
              <Link href="/skills" className="link text-sm">
                {t("profile.skillsLink")}
              </Link>
            </div>
            <SkillTree learnerId={learnerId} />
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">{t("profile.recent")}</h2>
              {recent.length > 0 && <span className="text-xs text-text-subtle tnum">{recent.length}</span>}
            </div>
            <div className="panel divide-y divide-border overflow-hidden">
              {!profile ? (
                [...Array(4)].map((_, i) => <div key={i} className="m-3 h-10 skeleton" />)
              ) : recent.length === 0 ? (
                <p className="p-6 text-center text-sm text-text-subtle">{t("profile.noActivity")}</p>
              ) : (
                shownActivity.map((r, i) => (
                  <Link
                    key={i}
                    href={`/labs/${r.lab_id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-good/10 text-good">
                      <Icon name="check" size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{r.step_title}</span>
                      <span className="block truncate text-xs text-text-subtle">{r.lab_title}</span>
                    </span>
                    {r.xp > 0 && <span className="text-xs font-medium text-iris tnum">+{r.xp}&nbsp;XP</span>}
                    <span className="w-20 shrink-0 text-right text-[11px] text-text-subtle tnum">{timeAgo(r.at, locale)}</span>
                  </Link>
                ))
              )}
              {recent.length > 6 && (
                <button
                  type="button"
                  onClick={() => setAllActivity((v) => !v)}
                  aria-expanded={allActivity}
                  className="flex w-full items-center justify-center gap-1 py-2.5 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  {allActivity ? t("profile.showLess") : t("profile.showAll", { n: recent.length })}
                  <Icon name="chevron-down" size={13} className={allActivity ? "rotate-180" : ""} />
                </button>
              )}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-10">
          <QuestList compact />

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">{t("certs.title")}</h2>
              <Link href="/certifications" className="link text-xs">
                {t("profile.shareCert")}
              </Link>
            </div>
            {certificates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-strong px-5 py-6 text-center text-sm text-text-muted">
                {t("profile.noCerts")}{" "}
                <Link href="/certifications" className="link">
                  {t("profile.shareFirst")}
                </Link>
              </div>
            ) : (
              <ul className="panel divide-y divide-border overflow-hidden">
                {certificates.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted">
                      <Icon name="award" size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text">{c.title}</p>
                      <p className="mt-0.5 text-xs text-text-subtle tnum">
                        {[c.issuer, c.obtained_on ? fmtDate(c.obtained_on) : fmtDate(c.created_at)].filter(Boolean).join(" · ")}
                      </p>
                      {c.expires_on && (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-subtle">
                          {t("certs.validUntil", { date: fmtDate(c.expires_on) })}
                          <ExpiryBadge expiresOn={c.expires_on} />
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* ---- Badge shelf --------------------------------------------------- */}
      <section className="border-t border-border pt-8">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{t("profile.badges")}</h2>
          <span className="text-xs text-text-subtle tnum">{t("profile.badgesOf", { n: earned.size, total: catalog.length })}</span>
        </div>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {shelf.map((b) => {
            const has = earned.has(b.id);
            return (
              <li
                key={b.id}
                className={`flex items-center justify-center rounded-xl border p-2.5 transition-colors ${
                  has ? "border-border bg-surface" : "border-dashed border-border opacity-70 hover:opacity-100"
                }`}
              >
                <AchievementBadge
                  emoji={b.emoji}
                  label={b.name}
                  tier={tierFor(b.id)}
                  locked={!has}
                  size={60}
                  title={`${b.name} — ${b.description}`}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
