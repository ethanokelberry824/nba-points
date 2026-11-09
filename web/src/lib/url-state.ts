"use client";

/**
 * The Matchup page keeps its choices (player, opponent, home/away, date, who's out) in the
 * URL, so a link or a refresh brings back the same matchup. Next.js syncs
 * window.history.replaceState with useSearchParams, so components re-render on change.
 */

export function setUrlParams(updates: Record<string, string | null>) {
  const s = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") s.delete(k);
    else s.set(k, v);
  }
  const q = s.toString();
  window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
}

export const parseIds = (v: string | null) =>
  (v ?? "")
    .split(",")
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
