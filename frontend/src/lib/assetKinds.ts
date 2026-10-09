// Shared display metadata for asset kinds.
export const ASSET_KINDS: { id: string; label: string; emoji: string }[] = [
  { id: "notebook", label: "Notebook", emoji: "📓" },
  { id: "code", label: "Code", emoji: "💻" },
  { id: "model", label: "Model / Invention", emoji: "🤖" },
  { id: "dataset", label: "Dataset", emoji: "🗃️" },
  { id: "idea", label: "Idea", emoji: "💡" },
];

export function kindMeta(id: string) {
  return ASSET_KINDS.find((k) => k.id === id) ?? { id, label: id, emoji: "📦" };
}
