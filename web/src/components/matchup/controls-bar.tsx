"use client";

import { ChevronsUpDown } from "lucide-react";
import { useId } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Player, Team } from "@/lib/api";
import { fmt, initials } from "@/lib/format";
import { searchStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

function Field({ label, htmlFor, labelId, children, className }: { label: string; htmlFor?: string; labelId?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} id={labelId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Player / opponent / home-away / date. The opponent field is left out on vs Every Team. */
export function ControlsBar({
  player,
  teams,
  oppId,
  home,
  date,
  minDate,
  maxDate,
  onOpp,
  onHome,
  onDate,
}: {
  player: Player;
  teams?: Team[];
  oppId?: number;
  home: boolean;
  date: string;
  minDate: string;
  maxDate: string;
  onOpp?: (id: number) => void;
  onHome: (home: boolean) => void;
  onDate: (d: string) => void;
}) {
  const id = useId();
  const withOpp = !!onOpp;
  const options = (teams ?? []).filter((t) => t.id !== player.team_id);

  return (
    <Card
      className={cn(
        "grid grid-cols-2 gap-3 px-3 py-3 sm:px-4 md:items-end",
        withOpp ? "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_auto_auto]" : "md:grid-cols-[minmax(0,1fr)_auto_auto]",
      )}
    >
      <Field label="Player" htmlFor={`${id}-player`} className={cn("col-span-2 md:col-span-1", !withOpp && "md:max-w-md")}>
        <button
          id={`${id}-player`}
          type="button"
          onClick={() => searchStore.set(true)}
          aria-haspopup="dialog"
          aria-label={`Player: ${player.name}. Press to search for another player`}
          className="flex h-11 w-full items-center gap-2.5 rounded-md border bg-background px-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand-ink">
            {initials(player.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{player.name}</span>
            <span className="block text-[11px] text-muted-foreground tabular-nums">
              {player.team}, {fmt(player.ppg)} ppg
            </span>
          </span>
          <kbd className="hidden h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:flex">
            ⌘K
          </kbd>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Field>

      {withOpp && (
        <Field label="Opponent" htmlFor={`${id}-opp`} className="col-span-2 md:col-span-1">
          {teams && oppId ? (
            <Select value={String(oppId)} onValueChange={(v) => onOpp(Number(v))}>
              <SelectTrigger id={`${id}-opp`} className="h-11! w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-80">
                {options.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <span className="inline-flex w-9 font-semibold">{t.abbr}</span>
                    <span className="truncate">{t.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-11 w-full" />
          )}
        </Field>
      )}

      <Field label="Where" labelId={`${id}-where`}>
        <ToggleGroup
          type="single"
          variant="outline"
          value={home ? "home" : "away"}
          onValueChange={(v) => v && onHome(v === "home")}
          aria-labelledby={`${id}-where`}
          className="h-11 w-full"
        >
          <ToggleGroupItem value="home" className="h-11 flex-1 px-4">
            Home
          </ToggleGroupItem>
          <ToggleGroupItem value="away" className="h-11 flex-1 px-4">
            Away
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Game date" htmlFor={`${id}-date`}>
        <Input
          id={`${id}-date`}
          type="date"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={(e) => e.target.value && e.target.value >= minDate && e.target.value <= maxDate && onDate(e.target.value)}
          className="h-11 w-full tabular-nums"
        />
      </Field>
    </Card>
  );
}
