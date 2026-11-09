"use client";

/**
 * The choices shared by Matchup and vs Every Team, read from the URL:
 *   ?player=<id>&opp=<team id>&home=1|0&date=YYYY-MM-DD&out=<ids>&oout=<ids>
 * Missing or invalid values fall back to defaults (top scorer, first other team, home,
 * today). Once everything is known, the full set is written back into the URL, so a
 * copied link always reopens exactly the same view.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { addDays } from "@/lib/format";
import { useMeta, usePlayers, useTeams } from "@/lib/hooks";
import { parseIds, setUrlParams } from "@/lib/url-state";

export function useSelection() {
  const sp = useSearchParams();
  const meta = useMeta();
  const players = usePlayers();

  const byId = useMemo(() => new Map((players.data ?? []).map((p) => [p.id, p])), [players.data]);
  const topScorer = useMemo(
    () =>
      (players.data ?? []).filter((p) => p.games >= 3).sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0))[0] ??
      players.data?.[0],
    [players.data],
  );
  const player = byId.get(Number(sp.get("player"))) ?? topScorer;

  const m = meta.data;
  const minDate = m ? addDays(m.stats_through, 1) : "";
  const maxDate = m ? `${Number(m.season.slice(0, 4)) + 1}-06-30` : "";
  const urlDate = sp.get("date") ?? "";
  const date = m ? (/^\d{4}-\d\d-\d\d$/.test(urlDate) && urlDate >= minDate && urlDate <= maxDate ? urlDate : m.default_date) : null;

  const teamsResp = useTeams(date);
  const teams = teamsResp.data?.teams;
  const urlOpp = Number(sp.get("opp"));
  const oppId =
    player && teams
      ? teams.some((t) => t.id === urlOpp && t.id !== player.team_id)
        ? urlOpp
        : (teams.find((t) => t.id !== player.team_id)?.id ?? null)
      : null;
  const home = sp.get("home") !== "0";

  const outStr = sp.get("out") ?? "";
  const ooutStr = sp.get("oout") ?? "";
  const teamOut = useMemo(() => parseIds(outStr).filter((id) => id !== player?.id), [outStr, player?.id]);
  const oppOut = useMemo(() => parseIds(ooutStr), [ooutStr]);

  // write the resolved choices back, so the address bar is always a complete link
  const playerId = player?.id;
  useEffect(() => {
    if (!playerId || !date) return;
    const want: Record<string, string> = { player: String(playerId), date, home: home ? "1" : "0" };
    if (oppId) want.opp = String(oppId);
    const cur = new URLSearchParams(window.location.search);
    if (Object.entries(want).some(([k, v]) => cur.get(k) !== v)) setUrlParams(want);
  }, [playerId, date, home, oppId]);

  return {
    meta: m,
    players: players.data,
    error: meta.error ?? players.error,
    retry: () => {
      meta.mutate();
      players.mutate();
    },
    player,
    date,
    minDate,
    maxDate,
    home,
    teams,
    oppId,
    teamOut,
    oppOut,
  };
}

/** Query string carrying the shared choices to another page. */
export function selectionQuery(sp: URLSearchParams, keys = ["player", "opp", "home", "date"]) {
  const out = new URLSearchParams();
  for (const k of keys) {
    const v = sp.get(k);
    if (v) out.set(k, v);
  }
  const q = out.toString();
  return q ? `?${q}` : "";
}
