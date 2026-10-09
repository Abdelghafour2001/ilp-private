"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// In-app slide viewer. PDFs render natively in an iframe; other formats
// (PPTX/PPT/Key) can't be previewed locally, so we offer a clean download.
export default function DeckViewer({
  sessionId,
  originalName,
}: {
  sessionId: number;
  originalName: string | null;
}) {
  const [open, setOpen] = useState(true);
  const ext = (originalName ?? "").toLowerCase().split(".").pop() ?? "";
  const isPdf = ext === "pdf";
  const viewUrl = api.deckViewUrl(sessionId);
  const dlUrl = api.deckUrl(sessionId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-text-muted">
          📎 {originalName ?? "Slide deck"}
        </span>
        {isPdf && (
          <button className="btn-ghost py-1.5" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide preview" : "Show preview"}
          </button>
        )}
        <a href={dlUrl} download className="btn-ghost py-1.5">
          ⤓ Download
        </a>
        {isPdf && (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost py-1.5">
            ⛶ Open full screen
          </a>
        )}
      </div>

      {isPdf ? (
        open && (
          <iframe
            src={viewUrl}
            title="Slide deck"
            className="h-[600px] w-full rounded-lg border border-edge bg-white"
          />
        )
      ) : (
        <div className="card text-sm text-text-subtle">
          In-browser preview isn&apos;t available for{" "}
          <code className="text-text-muted">.{ext || "this format"}</code> files — download to view.
          <span className="mt-1 block text-xs text-text-subtle">
            Tip: export the deck to PDF before uploading to get an inline preview here.
          </span>
        </div>
      )}
    </div>
  );
}
