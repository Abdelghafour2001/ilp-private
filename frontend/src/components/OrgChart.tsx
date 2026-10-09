"use client";

/**
 * The reporting line, drawn as a vertical chart.
 *
 * The org tab used to hang every team off the viewer directly, which is a list
 * with an avatar on top, not a hierarchy — an HR lead could not see which HRBP
 * was accountable for which BU. This draws the real chain: HR lead over HRBPs,
 * each HRBP over one or two BUs, each BU holding teams under their managers,
 * and the people under those.
 *
 * Vertical rather than the usual centred org chart on purpose: five levels deep
 * and twenty people wide, a centred tree needs horizontal scrolling before it
 * fits anything real. A spine that runs top to bottom stays readable on a
 * laptop and on a phone, and keeps every sibling aligned on the same left edge
 * so the eye can run down a level without tracking sideways.
 */

import { useState } from "react";
import Link from "next/link";
import type { OrgChart as OrgChartData, OrgChartBu, OrgChartTeam, OrgPerson } from "@/lib/api";
import { useT } from "@/lib/i18n";
import Icon from "@/components/Icon";

/** Role labels arrive as keys so the API stays language-neutral. Anything we
 *  do not recognise is shown as-is rather than swallowed. */
function useRoleLabel() {
  const t = useT();
  return (key: string) => {
    if (!key) return "";
    const translated = t(`org.role.${key}`);
    return translated === `org.role.${key}` ? key : translated;
  };
}

function initials(nameOrHandle: string) {
  return nameOrHandle
    .split(/[\s.\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Each level gets its own hue, so depth is readable without counting indents. */
const LEVEL = {
  root: { rail: "bg-accent", dot: "bg-accent", ring: "ring-accent/30" },
  hrbp: { rail: "bg-iris", dot: "bg-iris", ring: "ring-iris/30" },
  bu: { rail: "bg-info", dot: "bg-info", ring: "ring-info/30" },
  team: { rail: "bg-border-strong", dot: "bg-border-strong", ring: "ring-border" },
} as const;

function Avatar({
  label,
  size = "md",
  tone = "muted",
}: {
  label: string;
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "iris" | "muted";
}) {
  const dim =
    size === "lg" ? "h-11 w-11 text-sm" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  const tones = {
    accent: "bg-accent/20 text-accent-text",
    iris: "bg-iris/20 text-iris",
    muted: "bg-surface-3 text-text-muted",
  };
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-bold ${dim} ${tones[tone]}`}
    >
      {initials(label)}
    </span>
  );
}

/** A small figure with its unit — the recurring shape at every level.
 *
 * The unit is passed as a translation key stem rather than a finished string so
 * "1 équipe" and "2 équipes" both read correctly; a single plural label reads as
 * a bug on every count of one, and those are common in a small org. */
function Stat({ value, unit }: { value: number; unit: "team" | "person" | "hrbp" | "bu" }) {
  const t = useT();
  const key =
    value === 1
      ? { team: "org.chart.team", person: "org.chart.person", hrbp: "org.chart.hrbp", bu: "org.chart.buOne" }[unit]
      : { team: "org.chart.teams", person: "org.chart.people", hrbp: "org.chart.hrbps", bu: "org.chart.bus" }[unit];
  return (
    <span className="whitespace-nowrap text-xs text-text-subtle">
      <b className="tabular-nums font-semibold text-text">{value}</b> {t(key)}
    </span>
  );
}

/**
 * One level of the spine: a vertical rail with an elbow into each child.
 * Children pass their own rail colour so a level reads as one colour group.
 */
function Branch({
  tone,
  children,
}: {
  tone: keyof typeof LEVEL;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-6 sm:pl-8">
      <span
        aria-hidden
        className={`absolute bottom-4 left-0 top-0 w-px ${LEVEL[tone].rail} opacity-30`}
      />
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** The elbow connecting the rail to one node, plus the dot on the node. */
function Elbow({ tone }: { tone: keyof typeof LEVEL }) {
  return (
    <>
      <span
        aria-hidden
        className={`absolute -left-6 top-6 h-px w-4 sm:-left-8 sm:w-6 ${LEVEL[tone].rail} opacity-30`}
      />
      <span
        aria-hidden
        className={`absolute -left-[7px] top-[21px] h-[9px] w-[9px] rounded-full ring-4 ring-bg sm:-left-[9px] ${LEVEL[tone].dot}`}
      />
    </>
  );
}

/** A name on the chart is the way into that person's learning record.
 *  Without an address there is no record to open, so the name stays text. */
function PersonLink({ email, children }: { email: string; children: React.ReactNode }) {
  if (!email) return <>{children}</>;
  return (
    <Link href={`/people/${encodeURIComponent(email)}`} className="hover:text-accent">
      {children}
    </Link>
  );
}

function MemberChip({ person }: { person: OrgPerson }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-xs"
      title={`${person.name} · ${person.role}${person.job_level ? ` · ${person.job_level}` : ""}`}
    >
      <Avatar label={person.name} size="sm" />
      <PersonLink email={person.email}>
        <span className="font-medium">{person.name}</span>
      </PersonLink>
    </span>
  );
}

function TeamNode({ team }: { team: OrgChartTeam }) {
  const t = useT();
  return (
    <div className="relative">
      <Elbow tone="team" />
      <div className="group rounded-xl border border-border bg-surface p-4 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{team.name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Stat value={team.member_count} unit="person" />
            </div>
          </div>
          <Link href={`/team?team=${team.id}`} className="btn-ghost btn-sm shrink-0">
            {t("org.chart.manageTeam")} <Icon name="arrow-right" size={13} />
          </Link>
        </div>

        {/* The two people accountable for the team, before its members. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {team.manager ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 py-0.5 pl-0.5 pr-2.5 text-xs">
              <Avatar label={team.manager.name} size="sm" tone="accent" />
              <PersonLink email={team.manager.email}>
                <span className="font-medium">{team.manager.name}</span>
              </PersonLink>
              <span className="text-text-subtle">{t("org.chart.manager")}</span>
            </span>
          ) : (
            <span className="badge bg-warn/15 text-warn">{t("org.chart.noManager")}</span>
          )}

        </div>

        {team.members.length > 0 && (
          <div className="mt-3 border-t border-border pt-2.5">
            <p className="mb-1.5 text-xs text-text-subtle">
              {t("org.chart.members")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {team.members.map((m) => (
                <MemberChip key={m.id} person={m} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BuNode({ bu, uncovered }: { bu: OrgChartBu; uncovered?: boolean }) {
  const t = useT();
  // BUs open by default: a chart that starts collapsed shows the viewer nothing
  // on load, which is the one thing this page exists to avoid. An empty BU is
  // the exception — there is nothing to open.
  const [open, setOpen] = useState(bu.team_count > 0);

  return (
    <div className="relative">
      <Elbow tone="bu" />
      <div className={`rounded-xl border ${uncovered ? "border-warn/40" : "border-border"} bg-surface-2/60`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={bu.team_count === 0}
          aria-expanded={open}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-left disabled:cursor-default"
        >
          <Icon
            name="chevron-right"
            size={14}
            className={`text-text-subtle transition-transform ${open ? "rotate-90" : ""} ${bu.team_count === 0 ? "opacity-0" : ""}`}
          />
          <span className="rounded bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">{t("org.chart.bu")}</span>
          <span className="mr-auto font-semibold">{bu.name}</span>
          {uncovered && (
            <span className="badge bg-warn/15 text-warn">{t("org.chart.noHrbp")}</span>
          )}
          <Stat value={bu.team_count} unit="team" />
          <Stat value={bu.headcount} unit="person" />
        </button>

        {/* Who runs the BU operationally. Distinct from the HRBP above it:
            the HRBP reports on the unit, the head decides in it — and takes the
            second stage of every training request raised inside. */}
        {bu.head ? (
          <div className="mx-3 mb-2.5 flex flex-wrap items-center gap-2 pl-6">
            <Avatar label={bu.head.name} size="sm" tone="iris" />
            <PersonLink email={bu.head.email}>
              <span className="text-xs font-semibold">{bu.head.name}</span>
            </PersonLink>
            <span className="text-[11px] text-text-subtle">{t("org.chart.buHead")}</span>
          </div>
        ) : (
          // A gap worth knowing about, said once in a line rather than a banner:
          // in an org with several headless BUs the banners drowned the chart.
          bu.headcount > 0 && (
            <p className="mx-3 mb-2.5 flex items-center gap-1.5 pl-6 text-xs text-warn">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
              {t("org.chart.noBuHead")}
            </p>
          )
        )}

        {open && bu.teams.length > 0 && (
          <div className="px-3 pb-3">
            <Branch tone="team">
              {bu.teams.map((team) => (
                <TeamNode key={team.id} team={team} />
              ))}
            </Branch>
          </div>
        )}
        {bu.team_count === 0 && (
          <p className="px-3 pb-2.5 pl-9 text-xs text-text-subtle">{t("org.chart.buEmpty")}</p>
        )}
      </div>
    </div>
  );
}

function HrbpNode({ hrbp }: { hrbp: OrgChartData["hrbps"][number] }) {
  const t = useT();
  const roleLabel = useRoleLabel();
  return (
    <div className="relative">
      <Elbow tone="hrbp" />
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-iris px-3 py-3">
          <Avatar label={hrbp.name} tone="iris" />
          <div className="mr-auto min-w-0">
            <PersonLink email={hrbp.email}>
              <p className="truncate font-semibold">{hrbp.name}</p>
            </PersonLink>
            <p className="text-xs text-text-subtle">
              {roleLabel(hrbp.role_label)}
              {hrbp.bus.length > 0 && ` · ${hrbp.bus.map((b) => b.name).join(", ")}`}
            </p>
          </div>
          {hrbp.unassigned ? (
            <span className="badge bg-warn/15 text-warn">{t("org.chart.noPerimeter")}</span>
          ) : (
            <>
              <Stat value={hrbp.bu_count} unit="bu" />
              <Stat value={hrbp.headcount} unit="person" />
            </>
          )}
        </div>

        {hrbp.bus.length > 0 && (
          <div className="px-3 pb-3">
            <Branch tone="bu">
              {hrbp.bus.map((bu) => (
                <BuNode key={bu.name} bu={bu} />
              ))}
            </Branch>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OrgChart({ data }: { data: OrgChartData }) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const { root, totals } = data;

  return (
    <div className="flex flex-col gap-4">
      {/* Root — the viewer, at the top of what they can see. */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar label={root?.name ?? "HR"} size="lg" tone="accent" />
          <div className="mr-auto min-w-0">
            <PersonLink email={root?.email ?? ""}>
              <p className="text-lg font-semibold">{root?.name ?? "HR"}</p>
            </PersonLink>
            <p className="text-xs text-text-subtle">
              {roleLabel(root?.role_label ?? "") || t("org.chart.hrRole")} · {data.scope.label}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* An HRBP's own chart counts one HRBP: themself. Not worth a stat. */}
            {data.root_leads_hrbps && <Stat value={totals.hrbps} unit="hrbp" />}
            <Stat value={totals.bus} unit="bu" />
            <Stat value={totals.teams} unit="team" />
            <Stat value={totals.people} unit="person" />
          </div>
        </div>
        <p className="mt-2 max-w-prose text-xs text-text-subtle">
          {data.root_leads_hrbps ? t("org.chart.leadNote") : t("org.chart.hrbpNote")}
        </p>
      </div>

      {data.hrbps.length > 0 && (
        <Branch tone="hrbp">
          {data.hrbps.map((h) => (
            <HrbpNode key={h.id} hrbp={h} />
          ))}
        </Branch>
      )}

      {/* BUs answering to nobody. Shown detached from the spine, because that
          is exactly their problem — they hang off no HRBP. */}
      {data.unattached_bus.length > 0 && (
        <div className="rounded-xl border border-dashed border-warn/50 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn">
            {t("org.chart.uncoveredTitle", { count: data.unattached_bus.length })}
          </p>
          <p className="mb-3 max-w-prose text-xs text-text-subtle">
            {t("org.chart.uncoveredBody")}
          </p>
          <div className="flex flex-col gap-3 pl-2">
            {data.unattached_bus.map((bu) => (
              <div key={bu.name} className="relative">
                <BuNode bu={bu} uncovered />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.hrbps.length === 0 && data.unattached_bus.length === 0 && (
        <p className="text-sm text-text-subtle">{t("org.chart.empty")}</p>
      )}
    </div>
  );
}
