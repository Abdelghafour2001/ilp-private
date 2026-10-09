const SEPARATOR = ";";

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const mustQuote = str.includes(SEPARATOR) || str.includes('"') || str.includes("\n") || str.includes("\r");
  if (!mustQuote) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const headerLine = columns.map(escapeCsvValue).join(SEPARATOR);
  const dataLines = rows.map((row) => columns.map((col) => escapeCsvValue(row[col])).join(SEPARATOR));
  return [headerLine, ...dataLines].join("\r\n");
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const csv = buildCsv(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function dateStamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}