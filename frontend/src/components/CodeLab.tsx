"use client";

import { useRef, useState } from "react";
import CodeEditor, { type EditorLanguage } from "@/components/CodeEditor";

// In-browser code exercise. Python runs via Pyodide (loaded from CDN on first
// use); JavaScript runs in a sandboxed function. This local run is a fast
// feedback loop only — passing is decided server-side when the learner submits
// (the server re-runs the code with the visible tests plus hidden ones).

let pyodidePromise: Promise<unknown> | null = null;

function loadPyodide(): Promise<unknown> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise((resolve, reject) => {
    const w = window as unknown as { loadPyodide?: (o: unknown) => Promise<unknown> };
    const init = () =>
      w
        .loadPyodide!({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
        .then(resolve, reject);
    if (w.loadPyodide) return init();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
    s.onload = init;
    s.onerror = () => reject(new Error("Could not load the Python runtime (needs internet)."));
    document.head.appendChild(s);
  });
  return pyodidePromise;
}

export default function CodeLab({
  language,
  starterCode,
  testCode,
  onCodeChange,
}: {
  language: string;
  starterCode: string;
  testCode: string;
  onCodeChange?: (code: string) => void;
}) {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const pyRef = useRef<unknown>(null);

  async function run() {
    setStatus("running");
    setOutput("");
    const logs: string[] = [];
    try {
      if (language === "python") {
        const py = (pyRef.current ??= await loadPyodide()) as {
          setStdout: (o: { batched: (s: string) => void }) => void;
          setStderr: (o: { batched: (s: string) => void }) => void;
          runPythonAsync: (c: string) => Promise<unknown>;
        };
        py.setStdout({ batched: (s) => logs.push(s) });
        py.setStderr({ batched: (s) => logs.push(s) });
        await py.runPythonAsync(`${code}\n\n${testCode}`);
      } else {
        // JavaScript: run user code + tests with a captured console.
        const capture = { log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) };
        // eslint-disable-next-line no-new-func
        const fn = new Function("console", `"use strict";\n${code}\n;\n${testCode}`);
        fn(capture);
      }
      setOutput(logs.join("\n") || "Local tests passed — submit to make it count.");
      setStatus("pass");
    } catch (e) {
      setOutput(`${logs.join("\n")}\n${String(e)}`.trim());
      setStatus("fail");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-text-subtle">{language}</span>
        <button className="btn-ghost btn-sm" onClick={run} disabled={status === "running"}>
          {status === "running" ? "Running…" : "▶ Run tests locally"}
        </button>
      </div>
      <CodeEditor
        value={code}
        onChange={(c) => {
          setCode(c);
          onCodeChange?.(c);
        }}
        language={(language as EditorLanguage) || "python"}
        onRun={run}
        minHeight="220px"
      />

      {language === "python" && status === "running" && !pyRef.current && (
        <p className="text-xs text-text-subtle">Loading the Python runtime (first run only)…</p>
      )}

      {output && (
        <pre
          className={`overflow-auto rounded-lg border p-3 text-xs ${
            status === "pass"
              ? "border-good/40 text-good"
              : status === "fail"
                ? "border-bad/40 text-bad"
                : "border-border text-text-muted"
          }`}
        >
          {output}
        </pre>
      )}
    </div>
  );
}
