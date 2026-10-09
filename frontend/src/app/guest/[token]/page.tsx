"use client";

/**
 * What somebody outside the company sees when they open their invitation.
 *
 * No account, no password, no sidebar: the token in the link is the whole
 * credential, and a guest asked to a two-hour workshop should not have to
 * register with a learning platform to say yes. The page answers three
 * questions — what, when, where — and offers two buttons.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, type GuestInvitation } from "@/lib/api";

export default function GuestInvitePage() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const token = params.token;
  const [data, setData] = useState<GuestInvitation | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reply = useCallback(
    async (answer: "accepted" | "declined") => {
      setBusy(true);
      try {
        const r = await api.guestReply(token, answer);
        setStatus(r.status);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    api
      .guestInvitation(token)
      .then((d) => {
        setData(d);
        setStatus(d.guest.status);
        // The email's two buttons carry the answer, so somebody who clicks
        // "accept" has already answered — don't make them click twice.
        const wanted = search.get("reply");
        if ((wanted === "accepted" || wanted === "declined") && d.guest.status === "invited") {
          reply(wanted);
        }
      })
      .catch((e) => setError(String((e as Error).message ?? e)));
  }, [token, search, reply]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <div className="card text-sm text-bad">{error}</div>
      </main>
    );
  }
  if (!data) return <main className="p-8 text-sm text-text-subtle">…</main>;

  const { session, guest, invited_by: invitedBy } = data;
  const when = new Date(session.starts_at);
  const where = session.meeting_url || session.location || "—";

  return (
    <main className="mx-auto max-w-lg space-y-5 p-6 sm:p-10">
      <p className="text-xs uppercase tracking-widest text-text-subtle">UpSkill</p>

      <div className="card space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{session.title}</h1>
          <p className="text-sm text-text-muted">
            {invitedBy} invites {guest.name}
            {guest.company && ` (${guest.company})`}
          </p>
        </div>

        {session.description && <p className="text-sm text-text-muted">{session.description}</p>}

        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          {[
            ["Date", when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })],
            ["Heure", `${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · ${session.duration_min} min`],
            ["Lieu", where],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-text-subtle">{label}</dt>
              <dd className="mt-0.5 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {status === "invited" ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => reply("accepted")}>
              {busy ? "…" : "Je serai présent"}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => reply("declined")}>
              Je ne peux pas
            </button>
          </div>
        ) : (
          <p className={`text-sm ${status === "accepted" ? "text-good" : "text-text-muted"}`}>
            {status === "accepted"
              ? "✓ Votre présence est confirmée. Vous recevrez les détails de connexion avant la session."
              : "Votre réponse a bien été enregistrée : vous ne participerez pas."}
          </p>
        )}

        {status !== "invited" && (
          <button className="btn-ghost btn-sm" disabled={busy} onClick={() => reply(status === "accepted" ? "declined" : "accepted")}>
            {status === "accepted" ? "Finalement, je ne peux pas" : "Finalement, je serai présent"}
          </button>
        )}
      </div>

      <p className="text-xs text-text-subtle">
        Vous n&apos;avez pas besoin de compte : ce lien vous identifie.
      </p>
    </main>
  );
}
