"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type AdminLabRow } from "@/lib/api";

export default function AdminLabs() {
  const router = useRouter();
  const [labs, setLabs] = useState<AdminLabRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.adminListLabs().then(setLabs).catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm(`Delete DB lab "${id}"? This can't be undone.`)) return;
    try {
      await api.adminDeleteLab(id);
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function reload() {
    const r = await api.adminReloadFiles();
    setMsg(`Reloaded ${r.loaded} file lab(s).`);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xs text-text-subtle hover:text-text-muted">
            ← Admin
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Manage labs</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={reload}>
            ↻ Reload files
          </button>
          <Link href="/admin/labs/new" className="btn">
            + New lab
          </Link>
        </div>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {msg && <div className="card border-good/40 text-sm text-good">{msg}</div>}

      <div className="card p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">Lab</th>
              <th className="px-4 py-3 font-medium">Track</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Steps</th>
              <th className="px-4 py-3 font-medium">XP</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {labs.map((lab) => (
              <tr key={`${lab.source}-${lab.id}`} className="border-t border-edge">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{lab.title}</span>
                  <span className="ml-2 font-mono text-xs text-text-subtle">{lab.id}</span>
                  {!lab.published && <span className="badge ml-2 bg-warn/15 text-warn">draft</span>}
                  {lab.overridden && (
                    <span className="badge ml-2 bg-edge text-text-subtle">overridden by DB</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-text-subtle">{lab.track}</td>
                <td className="px-4 py-2.5">
                  <span className={`badge ${lab.source === "db" ? "bg-accent/15 text-accent" : "bg-edge text-text-subtle"}`}>
                    {lab.source}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-text-subtle">{lab.steps}</td>
                <td className="px-4 py-2.5 text-text-subtle">{lab.total_xp}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    className="text-xs text-accent hover:underline"
                    onClick={() => router.push(`/admin/labs/${lab.id}/edit`)}
                  >
                    {lab.source === "file" ? "fork & edit" : "edit"}
                  </button>
                  {lab.source === "db" && (
                    <button
                      className="ml-3 text-xs text-bad hover:underline"
                      onClick={() => remove(lab.id)}
                    >
                      delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {labs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-text-subtle">
                  No labs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-subtle">
        File labs live in <code>backend/labs/</code> and are edited via PR. Editing one here saves a
        DB copy that overrides the file.
      </p>
    </div>
  );
}
