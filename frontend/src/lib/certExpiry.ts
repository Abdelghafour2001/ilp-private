/** Compare calendar dates only — avoids timezone off-by-one on ISO strings. */
function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayDateOnly(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Days until expiry (negative = already expired). */
export function daysUntilExpiry(expiresOn: string): number {
  const exp = parseDateOnly(expiresOn);
  const today = todayDateOnly();
  return Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export type ExpiryState = "valid" | "soon" | "expired";

export function expiryState(expiresOn: string | null | undefined): ExpiryState | null {
  if (!expiresOn) return null;
  const days = daysUntilExpiry(expiresOn);
  if (days < 0) return "expired";
  if (days < 60) return "soon";
  return "valid";
}

export const EXPIRY_BADGE: Record<Exclude<ExpiryState, "valid">, { label: string; className: string }> = {
  soon: { label: "⏳ Expire bientôt", className: "bg-warn/15 text-warn" },
  expired: { label: "⚠ Expirée", className: "bg-bad/15 text-bad" },
};

export function isExpiringWithinDays(expiresOn: string | null | undefined, withinDays: number): boolean {
  if (!expiresOn) return false;
  const days = daysUntilExpiry(expiresOn);
  return days >= 0 && days < withinDays;
}
