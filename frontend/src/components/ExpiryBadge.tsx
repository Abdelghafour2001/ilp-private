import { EXPIRY_BADGE, expiryState } from "@/lib/certExpiry";

export default function ExpiryBadge({ expiresOn }: { expiresOn: string | null | undefined }) {
  const state = expiryState(expiresOn);
  if (!state || state === "valid") return null;
  const badge = EXPIRY_BADGE[state];
  return <span className={`badge ${badge.className}`}>{badge.label}</span>;
}
