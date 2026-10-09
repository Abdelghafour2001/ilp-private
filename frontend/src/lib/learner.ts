// Lightweight client-side identity. The learner picks a handle once; we store
// {id, handle} in localStorage and the backend keeps XP/progress keyed by id.

import { api, type Learner } from "@/lib/api";

const KEY = "dqai.learner";

export function getStoredLearner(): Learner | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Learner) : null;
  } catch {
    return null;
  }
}

export function storeLearner(learner: Learner) {
  localStorage.setItem(KEY, JSON.stringify(learner));
  window.dispatchEvent(new Event("dqai-learner-changed"));
}

export function clearLearner() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("dqai-learner-changed"));
}

export async function claimHandle(handle: string): Promise<Learner> {
  const learner = await api.createLearner(handle.trim());
  storeLearner(learner);
  return learner;
}
