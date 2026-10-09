"use client";

/**
 * /pathways/<id> — the address every assignment notification and every email
 * points at.
 *
 * There was no such route: courses and trainings each have a detail page, the
 * pathway never got one, and the links were built the same way for all three.
 * So a mandatory pathway arrived in somebody's bell, they pressed it, and the
 * app answered 404 — on the one screen the campaign exists to open.
 *
 * Rather than a second rendering of a card the list already draws well, this
 * sends them to the list anchored on that pathway. One place stays responsible
 * for how a pathway looks, and old links in old notifications keep working.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PathwayRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/pathways#pathway-${params.id}`);
  }, [params.id, router]);

  return null;
}
