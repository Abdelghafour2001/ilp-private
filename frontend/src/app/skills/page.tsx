"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type Learner,
  type SkillContent,
  type SkillGap,
  type SkillRow,
  type Team,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import LearningLog from "@/components/LearningLog";
import SkillGapPanel from "@/components/SkillGapPanel";
import { useT } from "@/lib/i18n";

const LEVEL_LABEL = ["—", "Aware", "Beginner", "Practitioner", "Advanced", "Expert"];

function LevelDots({
  value,
  onChange,
}: {
  value: number;
  onChange?: (v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" title={LEVEL_LABEL[value]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={`h-3 w-3 rounded-full border transition ${
            n <= value ? "border-accent bg-accent" : "border-border-strong bg-transparent"
          } ${onChange ? "hover:scale-125" : ""}`}
          aria-label={`Level ${n}`}
        />
      ))}
    </span>
  );
}

export default function SkillsPage() {
  const t = useT();
  const [me, setMe] = useState<Learner | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [content, setContent] = useState<Record<number, SkillContent[]>>({});
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [gapTeamId, setGapTeamId] = useState<number | null>(null);
  const [gap, setGap] = useState<SkillGap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "hard" | "soft">("all");
  const [mineOnly, setMineOnly] = useState(false);

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api.listSkills(learner?.id).then(setSkills).catch((e) => setError(String(e)));
    if (learner) {
      api
        .listTeams(learner.id)
        .then((ts) => {
          setMyTeams(ts);
          setGapTeamId((cur) => cur ?? ts[0]?.id ?? null);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!gapTeamId) return;
    api
      .skillGap(gapTeamId, getStoredLearner()?.id)
      .then(setGap)
      .catch(() => setGap(null));
  }, [gapTeamId]);

  async function rate(skill: SkillRow, level: number) {
    if (!me) return;
    await api.followSkill(skill.id, me.id, { level }).catch(() => {});
    refresh();
  }

  async function toggleFollow(skill: SkillRow) {
    if (!me) return;
    await api.followSkill(skill.id, me.id, { following: !skill.following }).catch(() => {});
    refresh();
  }

  async function expand(skill: SkillRow) {
    const next = expanded === skill.id ? null : skill.id;
    setExpanded(next);
    if (next && !content[skill.id]) {
      const c = await api.skillContent(skill.id).catch(() => []);
      setContent((cur) => ({ ...cur, [skill.id]: c }));
    }
  }

  // The catalogue is the whole company — fourteen technical domains and four
  // behavioural ones — so it is searched and filtered rather than scrolled.
  const needle = query.trim().toLowerCase();
  const visible = skills.filter(
    (s) =>
      (kind === "all" || s.kind === kind) &&
      (!mineOnly || s.following) &&
      (!needle || `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(needle)),
  );
  const categories = [...new Set(visible.map((s) => s.category))];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Skills</h1>
        {/* A learner has no team matrix below — telling them one exists only
            raises a question the page then refuses to answer. */}
        <p className="mt-1 text-sm text-text-muted">
          Follow the skills you&apos;re building, rate where you stand (1 aware → 5 expert), and
          find the content that grows each one.
          {myTeams.length > 0 && " Your team's skill matrix is below."}
        </p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {!me && (
        <div className="card text-sm text-text-subtle">{t("common.signInFirst")}</div>
      )}

      {/* Where you stand vs what your role expects — the two numbers that make
          a skill rating actionable. */}
      <SkillGapPanel me={me} />

      {/* Learning that happened off-platform. Without this the hours figure is
          biased towards whatever we happen to instrument. */}
      <LearningLog me={me} skills={skills} />

      {/* Filters, because a 144-skill catalogue is not a list anybody reads top
          to bottom. Hard and soft are first-class: that is the split HR works
          in, and the one a learner thinks in too. */}
      <div className="card flex flex-wrap items-center gap-3">
        <input
          className="input min-w-[12rem] flex-1"
          placeholder={t("skills.search", "Search a skill or a domain…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-1">
          {([
            ["all", t("skills.all", "All")],
            ["hard", t("skills.hard", "Hard skills")],
            ["soft", t("skills.soft", "Soft skills")],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={`badge transition ${
                kind === value ? "badge-accent" : "bg-edge text-text-subtle hover:text-text"
              }`}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`badge transition ${
            mineOnly ? "badge-accent" : "bg-edge text-text-subtle hover:text-text"
          }`}
          onClick={() => setMineOnly(!mineOnly)}
        >
          {mineOnly ? "★" : "☆"} {t("skills.following", "Following")}
        </button>
        <span className="ml-auto text-xs text-text-subtle tnum">
          {visible.length}/{skills.length} · {categories.length}{" "}
          {t("skills.domains", "domains")}
        </span>
      </div>

      {visible.length === 0 && skills.length > 0 && (
        <p className="card text-sm text-text-subtle">
          {t("skills.noMatch", "No skill matches that. Try a shorter search, or clear the filters.")}
        </p>
      )}

      {categories.map((cat) => (
        <section key={cat} className="space-y-3">
          <h2 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            {cat}
            <span className="badge bg-edge font-normal normal-case text-text-subtle">
              {visible.find((s) => s.category === cat)?.kind === "soft"
                ? t("skills.soft", "Soft skills")
                : t("skills.hard", "Hard skills")}
            </span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible
              .filter((s) => s.category === cat)
              .map((s) => (
                <div key={s.id} className="card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{s.name}</p>
                    <button
                      className={`badge transition ${
                        s.following ? "badge-accent" : "bg-edge text-text-subtle hover:text-text"
                      }`}
                      disabled={!me}
                      onClick={() => toggleFollow(s)}
                    >
                      {s.following ? "★ following" : "☆ follow"}
                    </button>
                  </div>
                  {s.description && <p className="text-xs text-text-muted">{s.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs text-text-subtle">
                      My level:
                      <LevelDots value={s.my_level ?? 0} onChange={me ? (v) => rate(s, v) : undefined} />
                      <span className="text-text-muted">{LEVEL_LABEL[s.my_level ?? 0]}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-subtle">
                    <span>
                      {s.followers} follower{s.followers === 1 ? "" : "s"}
                    </span>
                    <button className="text-accent hover:underline" onClick={() => expand(s)}>
                      {s.content_count} learning item{s.content_count === 1 ? "" : "s"}{" "}
                      {expanded === s.id ? "▴" : "▾"}
                    </button>
                  </div>
                  {expanded === s.id && (
                    <div className="space-y-1 border-t border-border pt-2">
                      {(content[s.id] ?? []).map((c) => (
                        <Link
                          key={`${c.entity_type}-${c.entity_id}`}
                          href={
                            c.entity_type === "formation"
                              ? `/formations/${c.entity_id}`
                              : c.entity_type === "course"
                                ? `/courses/${c.entity_id}`
                                : "/certifications"
                          }
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-2"
                        >
                          <span>{c.emoji}</span>
                          <span className="truncate">{c.title}</span>
                          <span className="ml-auto text-[10px] uppercase text-text-subtle">
                            {c.entity_type === "formation" ? "training" : c.entity_type}
                          </span>
                        </Link>
                      ))}
                      {(content[s.id] ?? []).length === 0 && (
                        <p className="px-2 text-xs text-text-subtle">No content linked yet.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}

      {/* ---- team skill matrix (leads / managers / HR) ---- */}
      {myTeams.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
              🎯 Team skill matrix
            </h2>
            {myTeams.length > 1 && (
              <select
                className="input max-w-[220px] py-1 text-xs"
                value={gapTeamId ?? ""}
                onChange={(e) => setGapTeamId(Number(e.target.value))}
              >
                {myTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {gap && (
            <div className="card p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
                    <tr>
                      <th className="px-4 py-3 font-medium">Skill</th>
                      {gap.members.map((m) => (
                        <th key={m.id} className="px-2 py-3 text-center font-medium">
                          <span title={m.name || m.handle}>
                            {(m.name || m.handle)
                              .split(/[\s.]+/)
                              .slice(0, 2)
                              .map((p) => p[0]?.toUpperCase())
                              .join("")}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium">Avg</th>
                      <th className="px-4 py-3 text-right font-medium">≥ Practitioner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gap.skills.map((r) => (
                      <tr key={r.skill_id} className="border-t border-edge">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-[11px] text-text-subtle">{r.category}</p>
                        </td>
                        {gap.members.map((m) => {
                          const v = r.levels[String(m.id)];
                          return (
                            <td key={m.id} className="px-2 py-2.5 text-center">
                              {v ? (
                                <span
                                  className={`inline-block h-6 w-6 rounded-full text-xs font-bold leading-6 ${
                                    v >= 4
                                      ? "bg-good/20 text-good"
                                      : v >= 3
                                        ? "bg-accent/15 text-accent-text"
                                        : "bg-warn/15 text-warn"
                                  }`}
                                  title={LEVEL_LABEL[v]}
                                >
                                  {v}
                                </span>
                              ) : (
                                <span className="text-text-subtle">·</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right font-mono">{r.avg || "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={r.covered === 0 ? "text-bad font-medium" : "text-text-muted"}>
                            {r.covered}/{gap.members.length}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-edge px-4 py-2 text-[11px] text-text-subtle">
                Self-ratings: 1 aware · 2 beginner · 3 practitioner · 4 advanced · 5 expert.
                Rows with 0 practitioners are your gaps — assign the linked content to close them.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
