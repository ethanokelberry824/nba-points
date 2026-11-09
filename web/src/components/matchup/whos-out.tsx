"use client";

import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { RotationsResp, RotationTeam } from "@/lib/api";
import { fmt, initials, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { Change } from "./hero-card";

function TeamPanel({
  team,
  out,
  onToggle,
  missingMin,
  label,
}: {
  team: RotationTeam;
  out: Set<number>;
  onToggle: (id: number) => void;
  missingMin: number | null;
  label: string;
}) {
  const active = team.players.filter((p) => p.still_on_team);
  const gone = team.players.filter((p) => !p.still_on_team);
  const nOut = active.filter((p) => out.has(p.player_id)).length;

  return (
    <div className="min-w-0 rounded-lg border">
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <span className="flex h-7 min-w-10 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-bold">{team.abbr}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{team.name}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
        <div className="text-right text-[11px] leading-tight text-muted-foreground">
          {nOut > 0 ? <span className="font-medium text-foreground">{nOut} out</span> : "All playing"}
          {missingMin !== null && missingMin > 0 && <div className="tabular-nums">{fmt(missingMin, 0)} min missing</div>}
        </div>
      </div>
      <ul className="divide-y">
        {active.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No rotation players yet.</li>}
        {active.map((p) => {
          const isOut = out.has(p.player_id);
          const id = `sw-${team.team_id}-${p.player_id}`;
          return (
            <li key={p.player_id} className={cn("flex items-center gap-2.5 px-3 py-2 transition-colors", isOut && "bg-muted/40")}>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground transition-opacity",
                  isOut && "opacity-50",
                )}
              >
                {initials(p.name)}
              </span>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <div className={cn("truncate text-sm", isOut && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                  {p.name}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {fmt(p.usual_min, 0)} min
                  {p.missed_last_team_game && (
                    <span className="ml-1.5 text-amber-700 dark:text-amber-300">last played {shortDate(p.last_game)}</span>
                  )}
                </div>
              </label>
              <Switch id={id} checked={!isOut} onCheckedChange={() => onToggle(p.player_id)} aria-label={`${p.name} playing`} />
            </li>
          );
        })}
      </ul>
      {gone.length > 0 && (
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Already counted as out (no longer on the team): {gone.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}

export function WhosOut({
  rotations,
  teamOut,
  oppOut,
  onToggle,
  onReset,
  change,
  pending,
  teamMissing,
  oppMissing,
  playerName,
}: {
  rotations: RotationsResp | undefined;
  teamOut: number[];
  oppOut: number[];
  onToggle: (side: "team" | "opponent", id: number) => void;
  onReset: () => void;
  change: Change;
  pending: boolean;
  teamMissing: number | null;
  oppMissing: number | null;
  playerName: string;
}) {
  const anyOut = teamOut.length + oppOut.length > 0;
  const team = rotations?.teams.find((t) => t.side === "team");
  const opp = rotations?.teams.find((t) => t.side === "opponent");

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Who&apos;s out tonight</CardTitle>
        <CardDescription>
          Everyone plays unless you switch them off. Lists each team&apos;s rotation (15+ minutes a game) with usual minutes.
        </CardDescription>
        <CardAction>
          {anyOut && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <RotateCcw /> Reset
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex min-h-7 items-center gap-2 text-sm" aria-live="polite">
          {pending ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Updating prediction
            </span>
          ) : change ? (
            <span
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                change.delta >= 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg",
              )}
            >
              {change.text}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Flip a switch to see how {playerName}&apos;s number moves.</span>
          )}
        </div>
        {!team || !opp ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <Skeleton className="h-7 w-40" />
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-9 w-full" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <TeamPanel team={team} out={new Set(teamOut)} onToggle={(id) => onToggle("team", id)} missingMin={teamMissing} label="His team" />
            <TeamPanel team={opp} out={new Set(oppOut)} onToggle={(id) => onToggle("opponent", id)} missingMin={oppMissing} label="Opponent" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
