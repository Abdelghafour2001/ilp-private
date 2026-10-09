"use client";

/**
 * Drop a file, or click to pick one. Shows the chosen file with its size and
 * a way to take it back, and refuses wrong types and oversize files up front
 * instead of after a 60 MB upload.
 */

import { useRef, useState, type DragEvent } from "react";
import Icon from "@/components/Icon";
import { useT } from "@/lib/i18n";

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileDrop({
  id,
  file,
  onChange,
  accept,
  maxMb,
  label,
  hint,
}: {
  id: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** e.g. ".pptx,.pdf" */
  accept: string;
  maxMb: number;
  label: string;
  hint: string;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exts = accept.split(",").map((e) => e.trim().toLowerCase());

  function take(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
    if (!exts.includes(ext)) return setError(t("form.file.type", { ext, ok: exts.join(", ") }));
    if (f.size > maxMb * 1024 * 1024) return setError(t("form.file.size", { size: size(f.size), max: maxMb }));
    onChange(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent-text">
          <Icon name="file" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-text-subtle tnum">{size(file.size)}</p>
        </div>
        <button
          type="button"
          className="btn-icon h-8 w-8 hover:border-bad/40 hover:text-bad"
          onClick={() => {
            onChange(null);
            if (input.current) input.current.value = "";
          }}
          aria-label={t("form.file.remove", { name: file.name })}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
          over ? "border-accent bg-accent/5" : "border-border-strong hover:border-accent/60 hover:bg-surface"
        }`}
      >
        <span
          className={`grid h-10 w-10 place-items-center rounded-full transition-transform ${
            over ? "scale-110 bg-accent text-accent-fg" : "bg-surface-3 text-text-muted"
          }`}
        >
          <Icon name="plus" size={18} />
        </span>
        <span className="text-sm font-medium text-text">{label}</span>
        <span className="text-xs text-text-subtle">{hint}</span>
        <input
          ref={input}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => take(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p className="mt-1.5 text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
