"use client";

/**
 * Which modules this viewer gets, as the switchboard decided.
 *
 * Fetched once per page load and cached in memory: it is read by the sidebar,
 * the dashboard and the command palette, and three requests for one answer on
 * every navigation is three too many.
 *
 * Undefined means "not known yet", which every caller must treat as *show it*.
 * A sidebar that hides half of itself for a beat while this loads reads as a
 * broken menu, and the server refuses anything that is really off anyway.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

type Features = Record<string, boolean>;

let cache: Features | null = null;
let inflight: Promise<Features> | null = null;

export function forgetFeatures() {
  cache = null;
  inflight = null;
}

async function load(): Promise<Features> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api
      .myFeatures(getStoredLearner()?.id)
      .then((r) => {
        cache = r.features;
        return cache;
      })
      .catch(() => ({}) as Features)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useFeatures(): Features | undefined {
  const [features, setFeatures] = useState<Features | undefined>(cache ?? undefined);
  useEffect(() => {
    let alive = true;
    load().then((f) => alive && setFeatures(f));
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
