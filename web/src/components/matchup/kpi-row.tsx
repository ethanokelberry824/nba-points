"use client";

import { Sparkline } from "@/components/charts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HistoryResp, PredictResp } from "@/lib/api";
import { fmt, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

function Kpi({ label, value, sub, children }: { label: string; value: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card className="gap-2 px-4 py-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</div>
      <div className="min-h-4 text-xs text-muted-foreground">{sub}</div>
      <div className="mt-auto">{children}</div>
    </Card>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null || Number.isNaN(v)) return null;
  return (
    <span className={cn("rounded px-1 py-0.5 font-medium tabular-nums", v >= 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg")}>
      {signed(v)}
    </span>
  );
}

export function KpiRow({ data, history, oppId }: { data: PredictResp | undefined; history: HistoryResp | undefined; oppId: number }) {
  if (!data || !history) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="gap-3 px-4 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  const k = data.key_numbers;
  const pts = history.season_games.map((g) => g.pts);
  const running = pts.map((_, i) => pts.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1));
  const rolling5 = pts.map((_, i) => {
    const w = pts.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const fromLast = k.averages_from_last_season;
  const n = k.games_played;
  const seasonW = n / (n + 10);
  const prev = data.features.pts_prev_season;
  const vs = history.vs_opponents.find((v) => v.opp_id === oppId);
  const seasons = history.vs_opponents_seasons.join(" and ");

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Kpi
        label={fromLast ? "Season average (last season)" : "Season average"}
        value={fmt(k.season_avg)}
        sub={`${n} game${n === 1 ? "" : "s"} this season`}
      >
        <Sparkline data={running} />
      </Kpi>

      <Kpi
        label={fromLast ? "Last 5 (last season)" : "Last 5 games"}
        value={fmt(k.last_5_avg)}
        sub={
          <span className="flex items-center gap-1.5">
            <Delta v={k.last_5_avg !== null && k.season_avg !== null ? k.last_5_avg - k.season_avg : null} /> vs season
          </span>
        }
      >
        <Sparkline data={rolling5} color="var(--color-pred)" />
      </Kpi>

      <Kpi label="Blended average" value={fmt(k.blended_avg)} sub={prev !== null ? `Last season ${fmt(prev)} ppg` : "No last season (rookie)"}>
        <div className="space-y-1">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="bg-brand" style={{ width: `${(prev === null ? 1 : seasonW) * 100}%` }} />
            <div className="bg-muted-foreground/40" style={{ width: `${(prev === null ? 0 : 1 - seasonW) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>This season {Math.round((prev === null ? 1 : seasonW) * 100)}%</span>
            {prev !== null && <span>Last {Math.round((1 - seasonW) * 100)}%</span>}
          </div>
        </div>
      </Kpi>

      <Kpi
        label={`vs ${data.opponent.abbr}`}
        value={vs ? fmt(vs.avg_pts) : "n/a"}
        sub={
          vs ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {vs.games} meeting{vs.games === 1 ? "" : "s"}
              {k.vs_opponent.pts_vs_opp_rel !== null && k.vs_opponent.meetings > 0 && (
                <>
                  <Delta v={k.vs_opponent.pts_vs_opp_rel} /> vs usual
                </>
              )}
            </span>
          ) : (
            `No games vs them in ${seasons}`
          )
        }
      >
        {vs ? <Sparkline data={vs.game_log.map((g) => g.pts)} kind="bar" color="var(--color-brand)" /> : <div className="h-10" />}
      </Kpi>
    </div>
  );
}
