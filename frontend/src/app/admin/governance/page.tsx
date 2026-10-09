"use client";

/**
 * The governance console: the organisation as something you edit.
 *
 * Two tabs, because there are two jobs. **Organisation** is the structure —
 * units, who runs them, the teams inside — edited in place on a chart that
 * looks like the read-only one so nobody has to re-learn where things are.
 * **Collaborateurs** is the directory: search someone, change their role,
 * title, BU or team without leaving the row.
 *
 * Every write is optimistic-free: the call returns the new state and the page
 * refetches. Governance edits cascade (renaming a BU moves its people, naming a
 * head grants a role), so guessing the outcome locally would show a screen that
 * quietly disagrees with the database.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  type GovBu,
  type GovDirectoryPerson,
  type GovOverview,
  type Learner,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import AccessDenied from "@/components/AccessDenied";
import Modal from "@/components/Modal";
import Icon from "@/components/Icon";
import ReportsWorkbench from "@/components/ReportsWorkbench";

type Tab = "org" | "people" | "reports";

/** Role names are translated like anything else; the key is derived from the
 *  role so a new role needs a bundle entry, not a code change. */
const roleKey = (role: string) => `gov.role.${role}`;

export default function GovernancePage() {
  const [me, setMe] = useState<Learner | null>(null);
  const [tab, setTab] = useState<Tab>("org");
  const [overview, setOverview] = useState<GovOverview | null>(null);
  const [people, setPeople] = useState<GovDirectoryPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState({ q: "", bu: "", role: "" });
  const [inviteOpen, setInviteOpen] = useState(false);
  const t = useT();

  const learnerId = me?.id;
  const allowed = !!me && ["hr_lead", "admin"].includes(me.role ?? "");

  const load = useCallback(async () => {
    if (!learnerId) return;
    try {
      const [ov, dir] = await Promise.all([
        api.govOverview(learnerId),
        api.govPeople(learnerId, query),
      ]);
      setOverview(ov);
      setPeople(dir.people);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [learnerId, query]);

  useEffect(() => {
    setMe(getStoredLearner());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** Every mutation goes through here: run it, say what happened, refetch. */
  const run = useCallback(
    async (action: () => Promise<unknown>, message?: string) => {
      try {
        await action();
        if (message) setNote(message);
        await load();
      } catch (e) {
        setError(String(e).replace(/^Error:\s*/, ""));
      }
    },
    [load],
  );

  // The server refuses to let anyone but a platform admin grant the admin
  // role. Offering it in the dropdown anyway means L&D pick it, press save and
  // are told no — a door advertised to somebody who cannot open it.
  const grantable = (overview?.roles ?? []).filter(
    (role) => role !== "admin" || me?.role === "admin",
  );
  const buNames = useMemo(
    () => (overview?.business_units ?? []).map((b) => b.name),
    [overview],
  );

  if (me && !allowed) {
    return (
      <AccessDenied
        audience="access.audience.ld"
        detailKey="access.detail.governance"
        backHref="/org"
        backLabelKey="access.back.org"
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("gov.headingMerged", "Org & reports")}</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{t("gov.lede")}</p>
        </div>
        <button type="button" className="btn shrink-0" onClick={() => setInviteOpen(true)}>
          <Icon name="plus" size={16} /> {t("gov.invite")}
        </button>
      </header>

      {error && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
          <button type="button" aria-label={t("common.close")} onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <Icon name="x" size={14} />
          </button>
        </p>
      )}
      {note && (
        <p aria-live="polite" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
          <span className="inline-flex items-center gap-2">
            <Icon name="check" size={15} className="text-good" /> {note}
          </span>
          <button type="button" aria-label={t("common.close")} onClick={() => setNote(null)} className="shrink-0 text-text-subtle hover:text-text">
            <Icon name="x" size={14} />
          </button>
        </p>
      )}

      <div role="tablist" aria-label={t("gov.headingMerged", "Org & reports")} className="flex gap-6 border-b border-border">
        {([
          ["org", t("gov.tab.org"), "org"],
          ["people", t("gov.tab.people"), "team"],
          // The report builder used to be its own screen next to this one, and
          // L&D could not tell them apart: one said "Reports", the other
          // "Governance", and both were about the organisation. Same page now.
          ["reports", t("gov.tab.reports", "Reports"), "file"],
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            onClick={() => setTab(key)}
            aria-selected={tab === key}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              tab === key ? "border-accent text-text" : "border-transparent text-text-subtle hover:text-text"
            }`}
          >
            <Icon name={icon} size={14} /> {label}
            {key === "people" && people.length > 0 && (
              <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-text-muted tnum">{people.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "org" && overview && (
        <OrgEditor
          overview={overview}
          people={people}
          learnerId={learnerId}
          run={run}
        />
      )}

      {tab === "reports" && <ReportsWorkbench />}

      {tab === "people" && (
        <PeopleEditor
          people={people}
          buNames={buNames}
          roles={grantable}
          teams={(overview?.business_units ?? []).flatMap((b) => b.teams)}
          query={query}
          setQuery={setQuery}
          learnerId={learnerId}
          run={run}
        />
      )}

      {inviteOpen && (
        <InviteDialog
          buNames={buNames}
          roles={grantable}
          teams={(overview?.business_units ?? []).flatMap((b) => b.teams)}
          learnerId={learnerId}
          onClose={() => setInviteOpen(false)}
          onDone={(message) => {
            setInviteOpen(false);
            setNote(message);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ org editor -- */

function OrgEditor({
  overview,
  people,
  learnerId,
  run,
}: {
  overview: GovOverview;
  people: GovDirectoryPerson[];
  learnerId?: number;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [newBu, setNewBu] = useState("");
  const units = overview.business_units;

  return (
    <div className="space-y-4">
      {/* BU names people carry that the registry has never heard of. Each
          one is a click to register, rather than a name to retype below. */}
      {overview.orphan_bus.length > 0 && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warn">
                {overview.orphan_bus.length === 1
                  ? t("gov.orphan.titleOne")
                  : t("gov.orphan.title", { count: overview.orphan_bus.length })}
              </p>
              <p className="mt-1 max-w-[70ch] text-sm text-text-muted">{t("gov.orphan.body")}</p>
            </div>
            {overview.orphan_bus.length > 1 && (
              <button
                type="button"
                className="btn-soft btn-sm shrink-0"
                onClick={() =>
                  run(
                    () =>
                      overview.orphan_bus.reduce<Promise<unknown>>(
                        (chain, name) => chain.then(() => api.govCreateBu({ learner_id: learnerId, name })),
                        Promise.resolve(),
                      ),
                    t("gov.orphan.allDone", { count: overview.orphan_bus.length }),
                  )
                }
              >
                <Icon name="plus" size={14} /> {t("gov.orphan.registerAll")}
              </button>
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {overview.orphan_bus.map((name) => (
              <li key={name} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm">
                {name}
                <button
                  type="button"
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-accent-text hover:bg-accent/10"
                  aria-label={t("gov.orphan.registerOne", { name })}
                  onClick={() =>
                    run(() => api.govCreateBu({ learner_id: learnerId, name }), t("gov.bu.created", { name }))
                  }
                >
                  {t("gov.orphan.register")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Teams under no unit. They show as "Sans BU" on the org chart and had
          nowhere to be managed from, which is how three empty demo teams
          survived every clean-up. */}
      {overview.unattached_teams.length > 0 && (
        <div className="space-y-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div>
            <p className="text-sm font-semibold text-warn">
              {t("gov.teams.unattachedTitle", { count: overview.unattached_teams.length })}
            </p>
            <p className="mt-1 text-sm text-text-muted">{t("gov.teams.unattachedBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {overview.unattached_teams.map((team) => (
              <span
                key={team.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
              >
                {team.name}
                <span className="text-text-subtle">
                  {t("gov.bu.people", { count: team.member_count })}
                </span>
                <button
                  type="button"
                  className="grid h-5 w-5 place-items-center rounded-full text-text-subtle hover:bg-bad/10 hover:text-bad"
                  aria-label={`${t("gov.teams.delete")} — ${team.name}`}
                  onClick={() => {
                    if (team.member_count > 0) {
                      // Deleting a staffed team loses its manager and its
                      // assignments; say so rather than doing it quietly.
                      if (!window.confirm(t("gov.teams.deleteStaffed", { count: team.member_count })))
                        return;
                    }
                    run(
                      () => api.govDeleteTeam(team.id, learnerId),
                      t("gov.teams.deleted", { name: team.name }),
                    );
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        {creating ? (
          <>
            <div className="min-w-[220px] flex-1">
              <label htmlFor="gov-new-bu" className="text-sm font-medium">
                {t("gov.bu.name")}
              </label>
              <input
                id="gov-new-bu"
                autoFocus
                className="input mt-1 w-full"
                value={newBu}
                placeholder={t("gov.bu.placeholder")}
                onChange={(e) => setNewBu(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setCreating(false);
                }}
              />
            </div>
            <button
              className="btn"
              disabled={newBu.trim().length < 2}
              onClick={() =>
                run(
                  () => api.govCreateBu({ learner_id: learnerId, name: newBu.trim() }),
                  t("gov.bu.created", { name: newBu.trim() }),
                ).then(() => {
                  setNewBu("");
                  setCreating(false);
                })
              }
            >
              {t("common.create")}
            </button>
            <button className="btn-ghost" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button type="button" className="btn-soft" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> {t("gov.bu.new")}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {units.map((unit, index) => (
          <BuCard
            key={unit.id}
            unit={unit}
            people={people}
            learnerId={learnerId}
            run={run}
            canMoveUp={index > 0}
            canMoveDown={index < units.length - 1}
            onMove={(direction) => {
              const order = units.map((u) => u.id);
              const to = index + direction;
              [order[index], order[to]] = [order[to], order[index]];
              return run(() => api.govReorderBus({ learner_id: learnerId, order }));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function BuCard({
  unit,
  people,
  learnerId,
  run,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  unit: GovBu;
  people: GovDirectoryPerson[];
  learnerId?: number;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: number) => Promise<void>;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(unit.name);
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamName, setTeamName] = useState("");

  const inUnit = people.filter((p) => p.bu === unit.name);
  const hrbpHandles = unit.hrbps.map((h) => h.handle);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-text-subtle">{unit.position}</span>
        {renaming ? (
          <>
            <input
              autoFocus
              className="input min-w-[220px] flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn btn-sm"
              onClick={() =>
                run(
                  () => api.govUpdateBu(unit.id, { learner_id: learnerId, name: name.trim() }),
                  t("gov.bu.renamed", { name: name.trim() }),
                ).then(() => setRenaming(false))
              }
            >
              {t("common.save")}
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setName(unit.name);
                setRenaming(false);
              }}
            >
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <h3 className="mr-auto text-lg font-semibold">{unit.name}</h3>
            <span className="text-xs text-text-subtle">
              {t("gov.bu.people", { count: unit.headcount })} ·{" "}
              {t("gov.bu.teams", { count: unit.teams.length })}
            </span>
            <button className="btn-ghost btn-sm" onClick={() => setRenaming(true)}>
              {t("common.rename")}
            </button>
            <button className="btn-ghost btn-sm" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={t("common.moveUp")}>
              ↑
            </button>
            <button className="btn-ghost btn-sm" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={t("common.moveDown")}>
              ↓
            </button>
            <button
              className="btn-ghost btn-sm text-bad"
              title={unit.headcount ? t("gov.bu.archiveBlocked") : t("common.archive")}
              onClick={() =>
                run(() => api.govArchiveBu(unit.id, learnerId), t("gov.bu.archived", { name: unit.name }))
              }
            >
              {t("common.archive")}
            </button>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PersonPicker
          label="gov.head.label"
          hint="gov.head.hint"
          people={people}
          value={unit.head?.handle ?? ""}
          onChange={(handle) =>
            run(
              () => api.govSetHead(unit.id, { learner_id: learnerId, handle: handle || null }),
              handle ? t("gov.head.set") : t("gov.head.cleared"),
            )
          }
        />
        <MultiPersonPicker
          label="gov.hrbp.label"
          hint="gov.hrbp.hint"
          people={people}
          values={hrbpHandles}
          onChange={(handles) =>
            run(
              () => api.govSetHrbps(unit.id, { learner_id: learnerId, handles }),
              t("gov.hrbp.updated"),
            )
          }
        />
      </div>

      {/* The métiers inside the unit. They were free text on each person until
          now, which is why the same practice could be spelled three ways. */}
      <div className="rounded-lg border border-border bg-surface-2 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-text-subtle">
            {t("gov.practices.heading")}
          </p>
          <button
            className="text-[11px] text-text-subtle hover:text-text"
            onClick={() => {
              const name = window.prompt(t("gov.practices.newPrompt"));
              if (name?.trim())
                run(
                  () => api.govCreatePractice({ learner_id: learnerId, bu_id: unit.id, name: name.trim() }),
                  t("gov.practices.created", { name: name.trim() }),
                );
            }}
          >
            + {t("gov.practices.add")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {unit.practices.map((practice) => (
            <span
              key={practice.id}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
            >
              {practice.name}
              <span className="text-text-subtle">{practice.headcount}</span>
              <button
                title={t("gov.practices.rename")}
                className="text-text-subtle hover:text-text"
                onClick={() => {
                  const name = window.prompt(t("gov.practices.rename"), practice.name);
                  if (name?.trim() && name.trim() !== practice.name)
                    run(
                      () => api.govUpdatePractice(practice.id, { learner_id: learnerId, name: name.trim() }),
                      t("gov.practices.renamed", { name: name.trim() }),
                    );
                }}
              >
                ✎
              </button>
              <button
                title={t("gov.practices.archive")}
                className="text-text-subtle hover:text-bad"
                onClick={() =>
                  run(
                    () => api.govArchivePractice(practice.id, learnerId),
                    t("gov.practices.archived", { name: practice.name }),
                  )
                }
              >
                ✕
              </button>
            </span>
          ))}
          {unit.practices.length === 0 && (
            <span className="text-xs text-text-subtle">{t("gov.practices.none")}</span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-2 p-2.5">
        <p className="mb-1.5 text-xs font-medium text-text-subtle">
          {t("gov.teams.heading")}
        </p>
        <div className="flex flex-col gap-1.5">
          {unit.teams.map((team) => (
            <div key={team.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{team.name}</span>
              <span className="text-xs text-text-subtle">
                {team.manager ? `${team.manager.name} · ${t("gov.role.manager")}` : t("gov.teams.noManager")} ·{" "}
                {t("gov.bu.people", { count: team.member_count })}
              </span>
              <select
                className="input ml-auto w-44 text-xs"
                value={team.manager?.handle ?? ""}
                onChange={(e) =>
                  run(
                    () =>
                      api.govUpdateTeam(team.id, {
                        learner_id: learnerId,
                        manager_handle: e.target.value,
                      }),
                    t("gov.teams.managerSet"),
                  )
                }
              >
                <option value="">{t("gov.teams.noManager")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.handle}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {unit.teams.length === 0 && (
            <p className="text-xs text-text-subtle">{t("gov.teams.empty")}</p>
          )}

          {addingTeam ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                autoFocus
                className="input min-w-[180px] flex-1 text-sm"
                placeholder={t("gov.teams.name")}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={teamName.trim().length < 2}
                onClick={() =>
                  run(
                    () => api.govCreateTeam({ learner_id: learnerId, name: teamName.trim() }),
                    // A team has no BU column: it lands in this unit once its
                    // members do, which the message says rather than implying.
                    t("gov.teams.created", { bu: unit.name }),
                  ).then(() => {
                    setTeamName("");
                    setAddingTeam(false);
                  })
                }
              >
                {t("common.create")}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setAddingTeam(false)}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button className="btn-ghost btn-sm w-fit" onClick={() => setAddingTeam(true)}>
              + {t("gov.teams.add")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function PersonPicker({
  label,
  hint,
  people,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  people: GovDirectoryPerson[];
  value: string;
  onChange: (handle: string) => void;
}) {
  const t = useT();
  return (
    <div>
      <label className="text-xs font-medium text-text-muted">
        {t(label)}
      </label>
      <p className="text-[11px] text-text-subtle">{t(hint)}</p>
      <select
        className="input mt-1 w-full text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("gov.head.unset")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.handle}>
            {p.name} {p.title ? `· ${p.title}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiPersonPicker({
  label,
  hint,
  people,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  people: GovDirectoryPerson[];
  values: string[];
  onChange: (handles: string[]) => void;
}) {
  // Only people who already carry an HR role, plus whoever is assigned today —
  // offering the whole company here is how somebody's developer ends up with a
  // reporting perimeter.
  const t = useT();
  const candidates = people.filter(
    (p) => ["hr", "hr_lead"].includes(p.role) || values.includes(p.handle),
  );
  return (
    <div>
      <label className="text-xs font-medium text-text-muted">
        {t(label)}
      </label>
      <p className="text-[11px] text-text-subtle">{t(hint)}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {candidates.map((p) => {
          const on = values.includes(p.handle);
          return (
            <button
              key={p.id}
              aria-pressed={on}
              onClick={() =>
                onChange(on ? values.filter((h) => h !== p.handle) : [...values, p.handle])
              }
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? "border-accent bg-accent/15 font-medium text-accent-text"
                  : "border-border text-text-subtle hover:text-text"
              }`}
            >
              {p.name}
            </button>
          );
        })}
        {candidates.length === 0 && (
          <p className="text-xs text-text-subtle">
            {t("gov.hrbp.none")}
          </p>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- people editor -- */

function PeopleEditor({
  people,
  buNames,
  roles,
  teams,
  query,
  setQuery,
  learnerId,
  run,
}: {
  people: GovDirectoryPerson[];
  buNames: string[];
  roles: string[];
  teams: { id: number; name: string }[];
  query: { q: string; bu: string; role: string };
  setQuery: (q: { q: string; bu: string; role: string }) => void;
  learnerId?: number;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
}) {
  const t = useT();
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium text-text-muted">
            {t("common.search")}
          </label>
          <input
            className="input mt-1 w-full"
            placeholder={t("gov.people.searchPlaceholder")}
            value={query.q}
            onChange={(e) => setQuery({ ...query, q: e.target.value })}
          />
        </div>
        <select
          className="input w-52"
          value={query.bu}
          onChange={(e) => setQuery({ ...query, bu: e.target.value })}
        >
          <option value="">{t("gov.people.allBus")}</option>
          {buNames.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          className="input w-48"
          value={query.role}
          onChange={(e) => setQuery({ ...query, role: e.target.value })}
        >
          <option value="">{t("gov.people.allRoles")}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(roleKey(r), r)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            open={openId === person.id}
            onToggle={() => setOpenId(openId === person.id ? null : person.id)}
            buNames={buNames}
            roles={roles}
            teams={teams}
            learnerId={learnerId}
            run={run}
          />
        ))}
        {people.length === 0 && (
          <p className="text-sm text-text-subtle">{t("gov.people.empty")}</p>
        )}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  open,
  onToggle,
  buNames,
  roles,
  teams,
  learnerId,
  run,
}: {
  person: GovDirectoryPerson;
  open: boolean;
  onToggle: () => void;
  buNames: string[];
  roles: string[];
  teams: { id: number; name: string }[];
  learnerId?: number;
  run: (a: () => Promise<unknown>, m?: string) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(person);
  const [password, setPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  useEffect(() => setDraft(person), [person]);

  const dirty =
    draft.name !== person.name ||
    draft.title !== person.title ||
    draft.role !== person.role ||
    draft.job_level !== person.job_level ||
    draft.practice !== person.practice ||
    draft.location !== person.location ||
    draft.matricule !== person.matricule ||
    draft.bu !== person.bu ||
    draft.team_id !== person.team_id;

  return (
    <div className="card">
      <button
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span aria-hidden className={`text-xs text-text-subtle transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="font-medium">{person.name}</span>
        {person.title && <span className="text-xs text-text-muted">{person.title}</span>}
        <span className="badge bg-surface-2 text-text-subtle">
          {t(roleKey(person.role), person.role)}
        </span>
        <span className="ml-auto text-xs text-text-subtle">
          {person.bu || t("gov.people.noBu")}
          {person.team ? ` · ${person.team}` : ""}
        </span>
      </button>

      {open && (
        <Modal
          title={person.name || person.handle}
          lede={person.handle}
          size="lg"
          onClose={onToggle}
          footer={
            <>
              {/* Leaving the company. Deliberately not a delete: their hours,
                  certificates and completed pathways stay in the reports they
                  already count towards, and only their place in the live
                  organisation goes. */}
              <button
                className="btn-ghost text-bad"
                onClick={() => {
                  if (!confirm(t("gov.people.deactivateConfirm", { name: person.name || person.handle },
                      "Remove {name} from the organisation? Their history stays in the reports."))) return;
                  run(
                    () => api.govDeactivate(person.id, learnerId),
                    t("gov.people.deactivated", { name: person.name || person.handle },
                      "{name} is no longer in the live organisation."),
                  );
                  onToggle();
                }}
              >
                {t("gov.people.deactivate", "Remove from the org")}
              </button>
              {dirty && (
                <button className="btn-ghost" onClick={() => setDraft(person)}>
                  {t("common.reset", "Reset")}
                </button>
              )}
              <button className="btn-ghost" onClick={onToggle}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                disabled={!dirty}
                onClick={() => {
                  run(
                    () =>
                      api.govUpdatePerson(person.id, {
                        learner_id: learnerId,
                        name: draft.name,
                        title: draft.title,
                        role: draft.role,
                        job_level: draft.job_level,
                        practice: draft.practice,
                        location: draft.location,
                        matricule: draft.matricule,
                        bu: draft.bu,
                        ...(draft.team_id === null
                          ? { clear_team: true }
                          : { team_id: draft.team_id }),
                      }),
                    t("gov.people.updated", { name: draft.name }),
                  );
                  onToggle();
                }}
              >
                {t("common.save")}
              </button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("common.name")} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <Field
              label={t("gov.people.jobTitle")}
              hint={t("gov.people.jobTitleHint")}
              value={draft.title}
              onChange={(v) => setDraft({ ...draft, title: v })}
            />
            <div>
              <label className="text-xs font-medium text-text-muted">
                {t("common.role")}
              </label>
              <p className="text-[11px] text-text-subtle">{t("gov.people.roleHint")}</p>
              <select
                className="input mt-1 w-full text-sm"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {t(roleKey(r), r)}
                  </option>
                ))}
              </select>
            </div>
            <Field label={t("common.practice")} value={draft.practice} onChange={(v) => setDraft({ ...draft, practice: v })} />
            <Field label={t("common.site")} value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
            <Field label={t("common.matricule")} value={draft.matricule} onChange={(v) => setDraft({ ...draft, matricule: v })} />
            <div>
              <label className="text-xs font-medium text-text-muted">
                BU
              </label>
              <select
                className="input mt-1 w-full text-sm"
                value={draft.bu}
                onChange={(e) => setDraft({ ...draft, bu: e.target.value })}
              >
                <option value="">{t("gov.people.noBu")}</option>
                {buNames.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted">
                {t("common.team")}
              </label>
              <select
                className="input mt-1 w-full text-sm"
                value={draft.team_id ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, team_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">{t("gov.people.noTeam")}</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Giving somebody a password. The endpoint existed and the client
              function existed; nothing ever called it, so the only way to let
              a colleague in was a curl command. There is no self-service
              reset, which makes this the whole of account recovery. */}
          <div className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3">
            <p className="text-xs font-medium text-text-muted">
              {t("gov.people.password", "Sign-in password")}
            </p>
            {person.email ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input min-w-[14rem] flex-1"
                    type="text"
                    placeholder={t("gov.people.passwordPlaceholder", "New password (12 characters minimum)")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    className="btn-soft"
                    disabled={password.trim().length < 12 || settingPassword}
                    onClick={async () => {
                      setSettingPassword(true);
                      setPasswordNote("");
                      try {
                        await api.setPassword({
                          email: person.email,
                          new_password: password,
                          learner_id: learnerId,
                        });
                        setPasswordNote(
                          t("gov.people.passwordSet", { email: person.email },
                            "Done. Give it to them yourself — nothing was emailed."),
                        );
                        setPassword("");
                      } catch (e) {
                        setPasswordNote(String((e as Error).message ?? e));
                      } finally {
                        setSettingPassword(false);
                      }
                    }}
                  >
                    {settingPassword ? t("common.saving", "Saving…") : t("gov.people.setPassword", "Set it")}
                  </button>
                </div>
                {/* Said plainly, because the reader will wonder: nobody is told. */}
                <p className="text-xs text-text-subtle">
                  {passwordNote || t("gov.people.passwordHint",
                    "They can sign in with this straight away. No email is sent — pass it on yourself.")}
                </p>
              </>
            ) : (
              <p className="text-xs text-warn">
                {t("gov.people.noEmail", "No email address on this account, so there is nothing to sign in with.")}
              </p>
            )}
          </div>

          {(person.heads_bus.length > 0 || person.hr_bus.length > 0) && (
            <p className="text-xs text-text-subtle">
              {person.heads_bus.length > 0 &&
                `${t("gov.people.headsOf", { bus: person.heads_bus.join(", ") })} `}
              {person.hr_bus.length > 0 && t("gov.people.hrScope", { bus: person.hr_bus.join(", ") })}
            </p>
          )}

        </Modal>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted">
        {label}
      </label>
      {hint && <p className="text-[11px] text-text-subtle">{hint}</p>}
      <input className="input mt-1 w-full text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ------------------------------------------------------------- invite -- */

function InviteDialog({
  buNames,
  roles,
  teams,
  learnerId,
  onClose,
  onDone,
}: {
  buNames: string[];
  roles: string[];
  teams: { id: number; name: string }[];
  learnerId?: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    handle: "",
    name: "",
    email: "",
    role: "user",
    title: "",
    job_level: "",
    practice: "",
    location: "",
    matricule: "",
    bu: "",
    team_id: "" as string,
    send_email: true,
    // Not part of the invitation payload — sent separately, see submit().
    password: "",
  });
  const t = useT();
  const [preview, setPreview] = useState<{ title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ten fields in one go is a wall. Who they are, then where they sit.
  const [step, setStep] = useState(0);

  // What they will land on, shown before anyone is created — so an empty
  // starting plan is noticed here rather than by the new joiner.
  useEffect(() => {
    api
      .govInvitePreview(form.bu, learnerId)
      .then((r) => setPreview(r.pathways))
      .catch(() => setPreview([]));
  }, [form.bu, learnerId]);

  const valid = form.handle.trim().length >= 2;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { password, ...details } = form;
      const created = await api.govInvite({
        learner_id: learnerId,
        ...details,
        team_id: form.team_id ? Number(form.team_id) : null,
      });
      // Two calls, because creating the account and giving it a password are
      // two different permissions on the server — and the second must not
      // undo the first if it fails, so the account survives either way.
      if (password.trim() && details.email.trim()) {
        await api.setPassword({
          email: details.email.trim(),
          new_password: password.trim(),
          learner_id: learnerId,
        }).catch((e) => setError(String((e as Error).message ?? e)));
      }
      onDone(
        t("gov.invite.done", { name: created.name, count: created.pathways.length }) +
          (created.emailed
            ? t("gov.invite.emailed")
            : created.email_configured
              ? t("gov.invite.emailFailed")
              : t("gov.invite.noEmail")),
      );
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("gov.invite")}
      lede={t("gov.invite.lede")}
      onClose={onClose}
      step={step}
      stepLabels={[t("gov.invite.step1", "Who"), t("gov.invite.step2", "Where they sit")]}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {step > 0 && (
            <button className="btn-soft" onClick={() => setStep(step - 1)}>
              {t("common.back", "Back")}
            </button>
          )}
          {step === 0 ? (
            <button className="btn" disabled={!valid} onClick={() => setStep(1)}>
              {t("common.next", "Next")}
            </button>
          ) : (
            <button className="btn" disabled={!valid || busy} onClick={submit}>
              {busy ? t("common.saving", "Saving…") : t("gov.invite.submit")}
            </button>
          )}
        </>
      }
    >
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("gov.invite.handle")} value={form.handle} onChange={(v) => setForm({ ...form, handle: v })} />
          <Field label={t("common.fullName")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label={t("common.email")} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label={t("gov.people.jobTitle")} value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-text-muted">{t("common.role")}</label>
            <select
              className="input mt-1 w-full text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(roleKey(r), r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-text-muted">BU</label>
            <select
              className="input mt-1 w-full text-sm"
              value={form.bu}
              onChange={(e) => setForm({ ...form, bu: e.target.value })}
            >
              <option value="">{t("gov.people.noBu")}</option>
              {buNames.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-text-muted">{t("common.team")}</label>
            <select
              className="input mt-1 w-full text-sm"
              value={form.team_id}
              onChange={(e) => setForm({ ...form, team_id: e.target.value })}
            >
              <option value="">{t("gov.people.noTeam")}</option>
              {teams.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <Field label={t("common.matricule")} value={form.matricule} onChange={(v) => setForm({ ...form, matricule: v })} />
          <Field label={t("common.practice")} value={form.practice} onChange={(v) => setForm({ ...form, practice: v })} />
          <Field label={t("common.site")} value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
        </div>
      )}

      {step === 1 && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs font-medium text-text-subtle">
            {t("gov.invite.pathways")}
          </p>
          {preview.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-sm text-text-muted">
              {preview.map((p) => (
                <li key={p.title}>{p.title}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-warn">
              {form.bu
                ? t("gov.invite.noPathwaysBu", { bu: form.bu })
                : t("gov.invite.noPathwaysAll")}
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-1.5 rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-xs font-medium text-text-muted">
            {t("gov.invite.password", "Password (optional)")}
          </p>
          <input
            className="input w-full"
            type="text"
            placeholder={t("gov.people.passwordPlaceholder")}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <p className="text-xs text-text-subtle">
            {t("gov.invite.passwordHint",
               "Set one now and they can sign in immediately. Leave it empty to set it later from their record. It is never emailed.")}
          </p>
        </div>
      )}

      {step === 1 && (
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={form.send_email}
            onChange={(e) => setForm({ ...form, send_email: e.target.checked })}
          />
          {t("gov.invite.sendEmail")}
        </label>
      )}

    </Modal>
  );
}
