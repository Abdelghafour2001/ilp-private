"use client";

import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useTheme } from "@/lib/theme";

export type EditorLanguage = "sql" | "python" | "javascript";

/** Table → columns map used for SQL autocomplete (from /sandbox/datasets). */
export type SqlSchema = Record<string, string[]>;

/**
 * The one code editor used everywhere: syntax highlighting, line numbers,
 * schema-aware SQL autocomplete, and Ctrl/Cmd+Enter to run. Follows the app
 * theme.
 */
export default function CodeEditor({
  value,
  onChange,
  language,
  schema,
  onRun,
  minHeight = "160px",
  readOnly = false,
}: {
  value: string;
  onChange: (code: string) => void;
  language: EditorLanguage;
  schema?: SqlSchema;
  onRun?: () => void;
  minHeight?: string;
  readOnly?: boolean;
}) {
  const { theme } = useTheme();

  // Keep the latest onRun in a ref so the keymap extension is stable.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const extensions = useMemo(() => {
    const lang =
      language === "sql"
        ? sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true })
        : language === "python"
          ? python()
          : javascript();
    const runKey = Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRunRef.current?.();
            return true;
          },
        },
      ]),
    );
    return [lang, runKey];
  }, [language, schema]);

  return (
    <div className="overflow-hidden rounded-lg border border-border text-sm shadow-xs [&_.cm-editor]:bg-surface [&_.cm-editor]:outline-none [&_.cm-gutters]:border-border [&_.cm-scroller]:font-mono">
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={theme}
        extensions={extensions}
        readOnly={readOnly}
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
        }}
      />
    </div>
  );
}
