"use client";

import { daysUntilExpiry, EXPIRY_BADGE, expiryState } from "@/lib/certExpiry";
import Icon from "@/components/Icon";
import { useT } from "@/lib/i18n";

/** "Expires in 23 days" / "Expired" — nothing at all while comfortably valid. */
export default function ExpiryBadge({ expiresOn }: { expiresOn: string | null | undefined }) {
  const t = useT();
  const state = expiryState(expiresOn);
  if (!state || state === "valid" || !expiresOn) return null;
  const days = daysUntilExpiry(expiresOn);
  return (
    <span className={`badge ${EXPIRY_BADGE[state].className}`}>
      <Icon name="clock" size={11} />
      {state === "expired" ? t("expiry.expired") : days === 0 ? t("expiry.today") : t("expiry.soon", { n: days })}
    </span>
  );
}
