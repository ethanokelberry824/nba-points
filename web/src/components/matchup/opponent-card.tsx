"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PredictResp } from "@/lib/api";
import { defenseWords, fmt, paceWords, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 30 ticks, rank 1 on the left. Highlights where this team sits. */
function RankMeter({ rank, goodLabel, badLabel }: { rank: number; goodLabel: string; badLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className={cn("h-2 flex-1 rounded-[1px]", i + 1 === rank ? "bg-brand" : "bg-muted")} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{goodLabel}</span>
        <span>{badLabel}</span>
      </div>
    </div>
  );
}

export function OpponentCard({ data }: { data: PredictResp | undefined }) {
  if (!data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-5">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const k = data.key_numbers;
  const oppStep = data.breakdown.steps.find((s) => s.key === "opponent");

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex h-10 min-w-12 items-center justify-center rounded-lg bg-muted px-2 text-sm font-bold">
            {data.opponent.abbr}
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">{data.opponent.name}</CardTitle>
            <CardDescription>Going into this game, blended with last season</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Defensive rating</span>
            <span className="text-xl font-semibold tabular-nums">{fmt(k.opp_def_rtg)}</span>
          </div>
          <p className="text-sm font-medium">{cap(defenseWords(k.opp_def_rank))}</p>
          <RankMeter rank={k.opp_def_rank} goodLabel="Toughest" badLabel="Weakest" />
          <p className="text-xs text-muted-foreground">Points allowed per 100 possessions. Lower is tougher.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Pace</span>
            <span className="text-xl font-semibold tabular-nums">{fmt(k.opp_pace)}</span>
          </div>
          <p className="text-sm font-medium">{cap(paceWords(k.opp_pace_rank))}</p>
          <RankMeter rank={k.opp_pace_rank} goodLabel="Fastest" badLabel="Slowest" />
          <p className="text-xs text-muted-foreground">Possessions per 48 minutes. More possessions, more chances to score.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Points allowed a game</div>
            <div className="font-semibold tabular-nums">{fmt(data.features.opp_pts_allowed)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Effect on his number</div>
            <div className={cn("font-semibold tabular-nums", (oppStep?.change ?? 0) >= 0 ? "text-pos" : "text-neg")}>
              {signed(oppStep?.change ?? null)} pts
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
