"use client";

import { useState } from "react";

// A code block with a copy-to-clipboard button and an optional filename/language
// label. Used in the Stacks recipes so the team can grab compose files & commands.
export default function CodeBlock({
  code,
  language,
  filename,
}: {
  code: string;
  language?: string | null;
  filename?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked in some contexts */
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-edge bg-ink">
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
        <span className="font-mono text-xs text-text-subtle">
          {filename || language || "code"}
        </span>
        <button
          onClick={copy}
          className="rounded px-2 py-0.5 text-xs text-text-subtle transition hover:bg-edge hover:text-text"
        >
          {copied ? "✓ copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-auto p-3 text-xs leading-relaxed">
        <code className="font-mono text-text">{code}</code>
      </pre>
    </div>
  );
}
