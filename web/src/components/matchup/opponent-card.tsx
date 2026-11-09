"use client";

import { ShieldAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PredictResp, RotationPlayer, RotationTeam } from "@/lib/api";
import { defenseWords, fmt, lastName, paceWords, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Key defender" lines: context only, the model doesn't use them. Shown when the opponent
 * defends at least 2 points per 100 possessions worse without him, and there are 5+ games
 * on each side of the comparison (raw, unshrunk numbers are very noisy before that). */
const KEY_DEF_DELTA = 2;
const KEY_DEF_MIN_GAMES = 5;

export function keyDefenders(opp: RotationTeam | undefined): RotationPlayer[] {
  return (opp?.players ?? [])
    .filter(
      (p) =>
        p.still_on_team &&
        p.def_delta != null &&
        p.def_delta >= KEY_DEF_DELTA &&
        (p.games_without ?? 0) >= KEY_DEF_MIN_GAMES &&
        (p.games_with ?? 0) >= KEY_DEF_MIN_GAMES,
    )
    .sort((a, b) => (b.def_delta ?? 0) - (a.def_delta ?? 0))
    .slice(0, 2);
}

/** "San Antonio Spurs" -> "Spurs", "Portland Trail Blazers" -> "Blazers" */
const nickname = (teamName: string) => teamName.split(" ").slice(-1)[0];

function KeyDefender({ p, teamName, isOut }: { p: RotationPlayer; teamName: string; isOut: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
        isOut && "border-amber-500/60 bg-amber-500/10",
      )}
    >
      <ShieldAlert className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", isOut && "text-amber-700 dark:text-amber-300")} aria-hidden />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">Key defender</span>
          {isOut && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Out tonight</span>}
        </div>
        <p className="leading-snug">
          {nickname(teamName)} allow {signed(p.def_delta ?? null)} points per 100 possessions without {lastName(p.name)} this season (
          {p.games_without} games).
        </p>
        <p className="text-xs text-muted-foreground">Context only: the model doesn&apos;t use this.</p>
      </div>
    </div>
  );
}

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

export function OpponentCard({
  data,
  rotation,
  oppOut,
}: {
  data: PredictResp | undefined;
  rotation?: RotationTeam;
  oppOut: number[];
}) {
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
  const keys = rotation?.team_id === data.opponent.id ? keyDefenders(rotation) : [];

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

        {keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((p) => (
              <KeyDefender key={p.player_id} p={p} teamName={data.opponent.name} isOut={oppOut.includes(p.player_id)} />
            ))}
          </div>
        )}

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
