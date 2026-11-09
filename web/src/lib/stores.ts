"use client";

/**
 * Two tiny shared stores (no library needed):
 *  - staleWarning: the Matchup page reports the warning for ITS game date, which is more
 *    specific than /meta's (default date). The top bar shows whichever is set.
 *  - search: open/close state of the Cmd+K player search, used by the top bar and the page.
 */

import { useSyncExternalStore } from "react";

function createStore<T>(initial: T) {
  let value = initial;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      if (v === value) return;
      value = v;
      ls.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
    initial,
  };
}

/** undefined = the page hasn't said (use /meta), null = no warning, string = warning */
export const staleStore = createStore<string | null | undefined>(undefined);
export const searchStore = createStore<boolean>(false);

export const useStore = <T,>(s: ReturnType<typeof createStore<T>>) =>
  useSyncExternalStore(s.subscribe, s.get, () => s.initial);
