"use client";

/**
 * One pager, for every long list on the platform.
 *
 * The roster went from a couple of dozen demo accounts to 275 real people, and
 * a Coursera profile can hold 226 enrolments. Anything that grew with them
 * turned into a page you scroll and scroll, so the rule is now simple: if a
 * list can outgrow a screen, it pages.
 *
 * It renders nothing when there is only one page — a pager under six rows is
 * furniture, not navigation.
 */

export const PAGE_SIZE = 25;

export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): T[] {
  return rows.slice(page * size, page * size + size);
}

export default function Pager({
  page,
  total,
  onPage,
  size = PAGE_SIZE,
}: {
  page: number;
  total: number;
  onPage: (next: number) => void;
  size?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-edge pt-2 text-sm">
      <button
        className="btn-ghost btn-sm disabled:opacity-40"
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
      >
        ←
      </button>
      <span className="tnum text-text-subtle">
        {page * size + 1}–{Math.min(total, (page + 1) * size)} / {total}
      </span>
      <button
        className="btn-ghost btn-sm disabled:opacity-40"
        disabled={page + 1 >= pages}
        onClick={() => onPage(Math.min(pages - 1, page + 1))}
      >
        →
      </button>
    </div>
  );
}
