"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiErrorCard, CopyLinkButton, PageHeader } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import type { PredictBody, PredictResp, RotationsResp } from "@/lib/api";
import { lastName, listWords, signed } from "@/lib/format";
import { useDebounced, useHistory, usePredict, useRotations } from "@/lib/hooks";
import { staleStore } from "@/lib/stores";
import { parseIds, setUrlParams } from "@/lib/url-state";
import { useSelection } from "@/lib/use-selection";

import { ControlsBar } from "./controls-bar";
import { type Change, HeroCard } from "./hero-card";
import { KpiRow } from "./kpi-row";
import { MatchupHistory } from "./matchup-history";
import { OpponentCard } from "./opponent-card";
import { RecentForm } from "./recent-form";
import { WhosOut } from "./whos-out";
import { WhyWaterfall } from "./why-waterfall";

const DEBOUNCE_MS = 350;
const ctxOf = (d: PredictResp) => `${d.player.id}|${d.opponent.id}|${d.date}|${d.home}`;

/** "+0.6 with Reaves out" from two predictions that differ only in who's out. */
function describeChange(prev: PredictResp, next: PredictResp, names: Map<number, string>): Change {
  const before = new Set([...prev.team_out_ids, ...prev.opp_out_ids]);
  const after = new Set([...next.team_out_ids, ...next.opp_out_ids]);
  const name = (id: number) => lastName(names.get(id) ?? "a player");
  const added = [...after].filter((id) => !before.has(id)).map(name);
  const removed = [...before].filter((id) => !after.has(id)).map(name);
  if (!added.length && !removed.length) return null;
  const parts = [];
  if (added.length) parts.push(`${listWords(added)} out`);
  if (removed.length) parts.push(`${listWords(removed)} back`);
  const delta = next.prediction - prev.prediction;
  return { delta, text: `${signed(delta)} with ${parts.join(", ")}` };
}

export function MatchupPage() {
  const sel = useSelection();
  const { player, oppId, date, home, teamOut, oppOut } = sel;

  // ---------------------------------------------------------------- prediction (debounced switch flips)
  const ctx = player && oppId && date ? `${player.id}|${oppId}|${date}|${home}` : null;
  const live = `${ctx}#${teamOut.join(",")}#${oppOut.join(",")}`;
  const debounced = useDebounced(live, DEBOUNCE_MS);
  // a new player / opponent / date goes out right away; only switch flips wait
  const effective = debounced.split("#")[0] === ctx ? debounced : live;
  const [, effOut, effOout] = effective.split("#");
  const body: PredictBody | null =
    player && oppId && date
      ? { player_id: player.id, opp_id: oppId, date, home, team_out_ids: parseIds(effOut), opp_out_ids: parseIds(effOout) }
      : null;
  const predict = usePredict(body);
  // keep showing the last number while the next one loads, but only for the same player
  const data = predict.data && player && predict.data.player.id === player.id ? predict.data : undefined;
  const updating = effective !== live || predict.isValidating;

  const rotationsRaw = useRotations(player?.id ?? null, oppId, date, home).data;
  const rotations: RotationsResp | undefined = useMemo(
    () =>
      rotationsRaw && {
        ...rotationsRaw,
        teams: rotationsRaw.teams.map((t) => ({ ...t, players: t.players.filter((p) => p.player_id !== player?.id) })),
      },
    [rotationsRaw, player?.id],
  );
  const names = useMemo(
    () => new Map((rotationsRaw?.teams ?? []).flatMap((t) => t.players.map((p) => [p.player_id, p.name] as const))),
    [rotationsRaw],
  );
  const { data: history } = useHistory(player?.id ?? null);

  // ---------------------------------------------------------------- "+0.6 with Reaves out"
  const [prev, setPrev] = useState<PredictResp | undefined>(undefined);
  const [change, setChange] = useState<Change>(null);
  if (data !== prev) {
    setPrev(data);
    setChange(data && prev && ctxOf(data) === ctxOf(prev) ? (describeChange(prev, data, names) ?? change) : null);
  }

  // stale-data banner for this game date
  useEffect(() => {
    if (data) staleStore.set(data.stale_warning);
  }, [data]);
  useEffect(() => () => staleStore.set(undefined), []);

  // ---------------------------------------------------------------- handlers
  const toggle = (side: "team" | "opponent", id: number) => {
    // read the list from the URL itself, not from this render: fast clicks can land
    // before the re-render, and a stale list would drop the earlier flips
    const key = side === "team" ? "out" : "oout";
    const list = parseIds(new URLSearchParams(window.location.search).get(key));
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].sort((a, b) => a - b);
    setUrlParams({ [key]: next.join(",") || null });
  };

  // ---------------------------------------------------------------- render
  if (sel.error) return <ApiErrorCard message={sel.error.message} onRetry={sel.retry} />;
  if (!sel.meta || !player || !date) return <MatchupSkeleton />;

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      <PageHeader
        title="Matchup"
        description="Pick a player and an opponent. A machine learning model predicts how many points he scores."
        actions={<CopyLinkButton />}
      />

      <ControlsBar
        player={player}
        teams={sel.teams}
        oppId={oppId ?? undefined}
        home={home}
        date={date}
        minDate={sel.minDate}
        maxDate={sel.maxDate}
        onOpp={(id) => setUrlParams({ opp: String(id), oout: null })}
        onHome={(h) => setUrlParams({ home: h ? "1" : "0" })}
        onDate={(d) => setUrlParams({ date: d })}
      />

      {/* phone order follows the reading order; on wide screens the who's-out switches sit next to the number */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section aria-label="Prediction" className="order-1 lg:col-span-5">
          <HeroCard data={data} meta={sel.meta} updating={updating} error={predict.error} onRetry={() => predict.mutate()} change={change} />
        </section>
        <section aria-label="Key numbers" className="order-2 lg:order-3 lg:col-span-12">
          <KpiRow data={data} history={history} oppId={oppId ?? 0} />
        </section>
        <section aria-label="Why this number" className="order-3 lg:order-4 lg:col-span-7">
          <WhyWaterfall data={data} />
        </section>
        <section aria-label="Who's out tonight" className="order-4 lg:order-2 lg:col-span-7">
          <WhosOut
            rotations={rotations}
            teamOut={teamOut}
            oppOut={oppOut}
            onToggle={toggle}
            onReset={() => setUrlParams({ out: null, oout: null })}
            change={change}
            pending={effective !== live}
            teamMissing={data?.key_numbers.team_missing_min ?? null}
            oppMissing={data?.key_numbers.opp_missing_min ?? null}
            teamMissingTsa={data?.key_numbers.team_missing_tsa ?? null}
            oppMissingTsa={data?.key_numbers.opp_missing_tsa ?? null}
            playerName={lastName(player.name)}
          />
        </section>
        <section aria-label="Opponent" className="order-6 lg:order-5 lg:col-span-5">
          <OpponentCard data={data} rotation={rotations?.teams.find((t) => t.side === "opponent")} oppOut={oppOut} />
        </section>
        <section aria-label="Recent form" className="order-5 lg:order-6 lg:col-span-7">
          <RecentForm games={history?.season_games} data={data} />
        </section>
        <section aria-label="Matchup history" className="order-7 lg:col-span-5">
          <MatchupHistory history={history} data={data} oppId={oppId ?? 0} />
        </section>
      </div>
    </div>
  );
}

export function MatchupSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-[74px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-96 rounded-xl lg:col-span-5" />
        <Skeleton className="h-96 rounded-xl lg:col-span-7" />
        <div className="grid grid-cols-2 gap-4 lg:col-span-12 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
