"use client";

import FormationBuilder from "@/components/FormationBuilder";
import { useT } from "@/lib/i18n";

export default function NewFormation() {
  const t = useT();
  return (
    <FormationBuilder
      back={{ href: "/formations", label: t("form.hub.title") }}
      title={t("fb.newTitle")}
      lede={t("fb.newLede")}
    />
  );
}
