// A tiny, dependency-free markdown renderer. Supports headings, bold, inline
// code, blockquotes, bullet and numbered lists, tables, and paragraphs — the
// subset our lab files, challenge briefs and shared assets actually use.
// Not a general markdown engine.

import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold**, *italic* and `code`, preserving delimiters. The bold
  // alternative is listed first so `**x**` is not consumed as an empty italic
  // followed by a stray asterisk.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-text">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) {
      return (
        <em key={key} className="italic text-text">
          {p.slice(1, -1)}
        </em>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-ink px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

const isTableRow = (line: string) => line.trim().startsWith("|") && line.includes("|", 1);
/** The |---|:--:|---| line. Without it a pipe in prose starts a phantom table. */
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export default function MarkdownLite({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // The line this block STARTS on. Multi-line blocks consume their lines
    // before the element is pushed, so keying on `i` at push time labels a
    // block with the index of the line after it — which is the next block's
    // own index, and React sees two children with the same key.
    const start = i;

    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++; // skip opening fence
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={`c${start}`}
          className="my-3 overflow-x-auto rounded-lg border border-edge bg-ink p-3 font-mono text-xs leading-relaxed text-text"
        >
          {code.join("\n")}
        </pre>,
      );
    } else if (line.startsWith("### ")) {
      blocks.push(<h4 key={start} className="mt-4 font-semibold">{inline(line.slice(4), `h${start}`)}</h4>);
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(<h3 key={start} className="mt-4 text-lg font-semibold">{inline(line.slice(3), `h${start}`)}</h3>);
      i++;
    } else if (line.startsWith("# ")) {
      blocks.push(<h2 key={start} className="mt-4 text-xl font-semibold">{inline(line.slice(2), `h${start}`)}</h2>);
      i++;
    } else if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote key={start} className="my-3 rounded-r-lg border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm text-text-muted">
          {inline(quote.join(" "), `q${start}`)}
        </blockquote>,
      );
    } else if (isTableRow(line) && isTableDivider(lines[i + 1] ?? "")) {
      // A table needs its header row AND the |---|---| under it. Checking only
      // for pipes turns any sentence containing one into a broken table.
      const header = splitRow(line);
      i += 2; // header + divider
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={start} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-left">
                {header.map((cell, c) => (
                  <th key={c} className="py-1.5 pr-4 font-semibold text-text">
                    {inline(cell, `th${start}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-edge/50 last:border-0">
                  {/* Pad short rows rather than dropping cells: a row with a
                      missing trailing pipe should lose alignment, not data. */}
                  {header.map((_, c) => (
                    <td key={c} className="py-1.5 pr-4 text-text-muted">
                      {inline(row[c] ?? "", `td${start}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={start} className="my-2 list-decimal space-y-1 pl-5 text-sm text-text-muted">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `oli${start}-${j}`)}</li>
          ))}
        </ol>,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={start} className="my-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li${start}-${j}`)}</li>
          ))}
        </ul>,
      );
    } else {
      blocks.push(
        <p key={start} className="my-2 text-sm leading-relaxed text-text-muted">
          {inline(line, `p${start}`)}
        </p>,
      );
      i++;
    }
  }

  return <div>{blocks}</div>;
}
