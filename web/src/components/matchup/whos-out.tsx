"use client";

import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { useId, useState } from "react";

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
  missingTsa,
  label,
  bare = false,
}: {
  team: RotationTeam;
  out: Set<number>;
  onToggle: (id: number) => void;
  missingMin: number | null;
  missingTsa: number | null;
  label: string;
  /** no outer border (when it sits inside the opponent disclosure) */
  bare?: boolean;
}) {
  const active = team.players.filter((p) => p.still_on_team);
  const gone = team.players.filter((p) => !p.still_on_team);
  const nOut = active.filter((p) => out.has(p.player_id)).length;

  return (
    <div className={cn("min-w-0", !bare && "rounded-lg border")}>
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <span className="flex h-7 min-w-10 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-bold">{team.abbr}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{team.name}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
        <div className="text-right text-[11px] leading-tight text-muted-foreground">
          {nOut > 0 ? <span className="font-medium text-foreground">{nOut} out</span> : "All playing"}
          {missingMin !== null && missingMin > 0 && (
            <div className="tabular-nums">
              {fmt(missingMin, 0)} min{missingTsa !== null ? `, ${fmt(missingTsa, 0)} shots` : ""} missing
            </div>
          )}
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
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground transition-colors",
                  isOut && "border border-dashed border-muted-foreground/60 bg-transparent",
                )}
              >
                {initials(p.name)}
              </span>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <div className={cn("truncate text-sm", isOut && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                  {p.name}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {fmt(p.usual_min, 0)} min, {fmt(p.usual_tsa, 0)} shots
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

const OPP_NOTE =
  "Opponent absences barely move this model. We tested blocks, steals, rebounds, plus-minus and a with/without defensive rating as 'missing defender' features, and none improved accuracy: box scores don't capture defense well, so a missing star defender is a known blind spot.";

/** The opponent's rotation, collapsed by default: its effect on the number is small. */
function OpponentDisclosure({
  team,
  out,
  onToggle,
  missingMin,
  missingTsa,
}: {
  team: RotationTeam;
  out: Set<number>;
  onToggle: (id: number) => void;
  missingMin: number | null;
  missingTsa: number | null;
}) {
  // open from the start when the link already has opponent players switched off
  const [open, setOpen] = useState(out.size > 0);
  const panelId = useId();
  const nOut = team.players.filter((p) => p.still_on_team && out.has(p.player_id)).length;
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex h-7 min-w-10 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-bold">{team.abbr}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Opponent players out (small effect)</span>
          <span className="block text-[11px] text-muted-foreground">
            {nOut > 0 ? `${nOut} switched off` : `${team.name}: everyone playing`}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="border-t">
          <p className="px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{OPP_NOTE}</p>
          <div className="border-t">
            <TeamPanel team={team} out={out} onToggle={onToggle} missingMin={missingMin} missingTsa={missingTsa} label="Opponent" bare />
          </div>
        </div>
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
  teamMissingTsa,
  oppMissingTsa,
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
  teamMissingTsa: number | null;
  oppMissingTsa: number | null;
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
          Everyone plays unless you switch them off. Lists each team&apos;s rotation (15+ minutes a game) with usual minutes
          and shots. A scorer sitting out frees up more shots than a role player with the same minutes.
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
                Math.abs(change.delta) < 0.05 ? "bg-muted text-muted-foreground" : change.delta > 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg",
              )}
            >
              {change.text}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Flip a switch to see how {playerName}&apos;s number moves.</span>
          )}
        </div>
        {!team || !opp ? (
          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border p-3">
              <Skeleton className="h-7 w-40" />
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-9 w-full" />
              ))}
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-3">
            <TeamPanel
              team={team}
              out={new Set(teamOut)}
              onToggle={(id) => onToggle("team", id)}
              missingMin={teamMissing}
              missingTsa={teamMissingTsa}
              label="His team"
            />
            <OpponentDisclosure
              key={opp.team_id}
              team={opp}
              out={new Set(oppOut)}
              onToggle={(id) => onToggle("opponent", id)}
              missingMin={oppMissing}
              missingTsa={oppMissingTsa}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
