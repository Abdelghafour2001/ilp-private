"use client";

import Link from "next/link";
import LabEditor from "@/components/LabEditor";

export default function NewLab() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/labs" className="text-xs text-text-subtle hover:text-text-muted">
          ← Manage labs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New lab</h1>
      </div>
      <LabEditor />
    </div>
  );
}
