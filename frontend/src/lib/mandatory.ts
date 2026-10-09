"use client";

/**
 * What the signed-in person has been assigned, for the catalogue pages.
 *
 * Courses, Pathways and Trainings each render a grid of everything published.
 * A learner opening one of them has no way to tell which two of sixty-six
 * entries are the ones they are actually required to finish — the deadline
 * lives on another screen. So each page asks this what is owed, lifts those
 * entries to the top, marks them, and can filter down to them.
 *
 * One fetch, shared shape, no page-local notion of "mandatory".
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

export interface Assigned {
  kind: "course" | "formation" | "pathway";
  id: number;
  title: string;
  link: string;
  mandatory: boolean;
  due_date: string | null;
  percent: number;
  done: boolean;
}

/** Assignments of one kind that are still owed, keyed by entity id. */
export function useMandatory(kind: Assigned["kind"]) {
  const [owed, setOwed] = useState<Map<number, Assigned>>(new Map());

  useEffect(() => {
    const me = getStoredLearner();
    if (!me) return;
    api
      .myAssignments(me.id)
      .then((r) => {
        const mine = r.items.filter(
          (a) => a.kind === kind && a.mandatory && !a.done,
        );
        setOwed(new Map(mine.map((a) => [a.id, a])));
      })
      .catch(() => {
        /* a catalogue that cannot say what is mandatory still lists courses */
      });
  }, [kind]);

  return owed;
}

/** Overdue as of today, for the red treatment rather than the amber one. */
export function isOverdue(a: Assigned): boolean {
  return !!a.due_date && a.due_date < new Date().toISOString().slice(0, 10);
}

/**
 * Owed entries first, then the rest in the order the server sent them.
 *
 * Sorting rather than splitting into two grids: a tester scrolling the
 * catalogue should meet their obligations on the way past, not in a separate
 * box they can learn to ignore. Soonest deadline leads; undated obligations
 * follow, still ahead of everything optional.
 */
export function mandatoryFirst<T extends { id: number }>(
  rows: T[],
  owed: Map<number, Assigned>,
  onlyOwed: boolean,
): T[] {
  const picked = onlyOwed ? rows.filter((r) => owed.has(r.id)) : rows;
  return [...picked].sort((a, b) => {
    const x = owed.get(a.id);
    const y = owed.get(b.id);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return (x.due_date ?? "9999").localeCompare(y.due_date ?? "9999");
  });
}
