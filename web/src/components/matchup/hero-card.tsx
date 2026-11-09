"use client";

import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import CountUp from "@/components/CountUp";
import SpotlightCard from "@/components/SpotlightCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Meta, PredictResp } from "@/lib/api";
import { fmt, signed, STEP_SHORT, weekdayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Change = { delta: number; text: string } | null;

function RangeBand({ low, high, pred, note }: { low: number; high: number; pred: number; note: string }) {
  const max = Math.max(10, Math.ceil((high + 4) / 10) * 10);
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="space-y-2">
      <div className="relative h-2.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-brand/35 transition-all duration-500"
          style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-brand shadow transition-all duration-500"
          style={{ left: pos(pred) }}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>0</span>
        <span>{max / 2}</span>
        <span>{max} pts</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="cursor-help text-sm text-muted-foreground underline decoration-dotted underline-offset-4">
            60% of the time between <span className="font-medium text-foreground tabular-nums">{fmt(low)}</span> and{" "}
            <span className="font-medium text-foreground tabular-nums">{fmt(high)}</span>
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{note}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function HeroCard({
  data,
  meta,
  updating,
  error,
  onRetry,
  change,
}: {
  data: PredictResp | undefined;
  meta: Meta | undefined;
  updating: boolean;
  error: Error | undefined;
  onRetry: () => void;
  change: Change;
}) {
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const pred = data ? Math.round(data.prediction * 10) / 10 : 0;
  const someoneOut = !!data && data.team_out_ids.length + data.opp_out_ids.length > 0;

  return (
    <div ref={ref} className="h-full">
      <SpotlightCard
        theme={resolvedTheme === "light" ? "light" : "dark"}
        spotlightColor="#3b82f6"
        intensity={0.45}
        spotlightSize={320}
        ambient
        className="flex h-full flex-col gap-5 rounded-xl p-5 ring-1 ring-foreground/10 sm:p-6"
        style={{ "--spotlight-card-surface": "var(--card)" } as React.CSSProperties}
      >
        {error && !data ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 py-8">
            <AlertCircle className="size-6 text-neg" />
            <p className="font-medium">Couldn&apos;t get a prediction</p>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          </div>
        ) : !data ? (
          <HeroSkeleton />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                    {data.player.team} {data.home ? "vs" : "@"} {data.opponent.abbr}
                  </span>
                  <span>{weekdayDate(data.date)}</span>
                  <span>{data.home ? "Home" : "Away"}</span>
                </div>
                <h2 className="mt-2 truncate text-lg font-semibold sm:text-xl">{data.player.name}</h2>
              </div>
              <span
                className={cn(
                  "flex items-center gap-1 text-xs text-muted-foreground transition-opacity",
                  updating ? "opacity-100" : "opacity-0",
                )}
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin" /> Updating
              </span>
            </div>

            <div>
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Predicted points</div>
              <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
                <CountUp
                  to={pred}
                  decimals={1}
                  duration={0.9}
                  trigger="load"
                  className="text-6xl leading-none font-semibold tracking-tight tabular-nums sm:text-7xl"
                />
                {change && (
                  <span
                    className={cn(
                      "mb-1.5 rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                      Math.abs(change.delta) < 0.05 ? "bg-muted text-muted-foreground" : change.delta > 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg",
                    )}
                  >
                    {change.text}
                  </span>
                )}
              </div>
              {someoneOut && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Everyone playing: <span className="font-medium text-foreground tabular-nums">{fmt(data.prediction_everyone_playing)}</span>
                </p>
              )}
            </div>

            <RangeBand low={data.likely_range.low} high={data.likely_range.high} pred={data.prediction} note={data.likely_range.note} />

            <dl className="grid grid-cols-3 gap-2">
              {[
                { k: "Usual minutes", v: fmt(data.key_numbers.usual_minutes) },
                {
                  k: "Days of rest",
                  v: data.key_numbers.rest_days === 0 ? "Back to back" : String(data.key_numbers.rest_days),
                },
                { k: "Scorer tier", v: data.likely_range.tier },
              ].map((s) => (
                <div key={s.k} className="rounded-lg bg-muted/50 px-3 py-2">
                  <dt className="text-[11px] leading-tight text-muted-foreground">{s.k}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>

            <FactorList steps={data.breakdown.steps} baseline={data.breakdown.baseline} />

            <div className="mt-auto space-y-2 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              {data.low_minutes_warning && (
                <p className="text-amber-700 dark:text-amber-300">
                  Heads up: he has been playing about {fmt(data.key_numbers.usual_minutes, 0)} minutes a game. The model was
                  trained on players averaging 15+, so this one is a rougher guess.
                </p>
              )}
              <p>
                Typically off by about {meta ? Math.round(meta.test_mae) : 5} points ({meta?.pct_within_5 ?? 60}% of
                predictions land within 5). Assumes normal minutes and doesn&apos;t know about injuries unless you switch
                players off below.
              </p>
            </div>
          </>
        )}
      </SpotlightCard>

      {/* phone: keep the number visible while scrolling through the toggles and charts */}
      {data && (
        <div
          className={cn(
            "fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 rounded-xl border bg-popover/95 px-4 py-2.5 shadow-lg backdrop-blur transition-all duration-300 lg:hidden",
            offscreen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
          )}
          aria-hidden={!offscreen}
        >
          <div className="min-w-0 text-xs">
            <div className="truncate font-medium">{data.player.name}</div>
            <div className="text-muted-foreground">
              {data.home ? "vs" : "@"} {data.opponent.abbr}
              {change ? `, ${change.text}` : ""}
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            {updating && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            <span className="text-2xl font-semibold tabular-nums">{fmt(data.prediction)}</span>
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Every "why this number" step as a small diverging bar, biggest first. */
function FactorList({ steps, baseline }: { steps: PredictResp["breakdown"]["steps"]; baseline: number }) {
  const sorted = steps.slice().sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const max = Math.max(0.5, ...steps.map((s) => Math.abs(s.change)));
  return (
    <div className="hidden lg:block">
      <div className="mb-2 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>What moved it from his baseline ({fmt(baseline)})</span>
        <span>pts</span>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((s) => {
          const w = `${(Math.abs(s.change) / max) * 50}%`;
          return (
            <li key={s.key} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-sm">
              <span className="truncate">{STEP_SHORT[s.key] ?? s.label}</span>
              <span className="relative h-1.5 rounded-full bg-muted" aria-hidden>
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <span
                  className={cn("absolute inset-y-0 rounded-full", s.change >= 0 ? "left-1/2 bg-pos" : "right-1/2 bg-neg")}
                  style={{ width: w }}
                />
              </span>
              <span
                className={cn(
                  "text-right font-medium tabular-nums",
                  Math.abs(s.change) < 0.05 ? "text-muted-foreground" : s.change > 0 ? "text-pos" : "text-neg",
                )}
              >
                {signed(s.change)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-40" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="mt-auto h-10 w-full" />
    </div>
  );
}
