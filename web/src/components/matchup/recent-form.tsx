"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AXIS, ChartTooltipBox, TooltipRow } from "@/components/charts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Game, PredictResp } from "@/lib/api";
import { fmt, shortDate } from "@/lib/format";

type Stat = "pts" | "min" | "tsa";
const STATS: Record<Stat, { label: string; short: string; unit: string }> = {
  pts: { label: "Points", short: "Points", unit: "pts" },
  min: { label: "Minutes", short: "Minutes", unit: "min" },
  tsa: { label: "Shot volume (FGA + 0.44 x FTA)", short: "Shots", unit: "shots" },
};

export function RecentForm({ games, data }: { games: Game[] | undefined; data: PredictResp | undefined }) {
  const [stat, setStat] = useState<Stat>("pts");

  if (!games || !data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = games.map((g) => ({ ...g, x: `${g.home ? "" : "@"}${g.opp}`, v: g[stat] ?? 0 }));
  const avg = rows.length ? rows.reduce((a, r) => a + r.v, 0) / rows.length : null;
  const dashed =
    stat === "pts"
      ? { y: data.prediction, label: `Prediction ${fmt(data.prediction)}` }
      : stat === "min" && data.key_numbers.usual_minutes !== null
        ? { y: data.key_numbers.usual_minutes, label: `Expected ${fmt(data.key_numbers.usual_minutes)}` }
        : null;
  const yMax = Math.max(...rows.map((r) => r.v), dashed?.y ?? 0, avg ?? 0, 1);
  // even ticks: step of 1, 2, 5, 10, 20... about 4 steps to the top
  const raw = yMax / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw) ?? 10 * pow;
  const top = Math.ceil((yMax + step * 0.1) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent form</CardTitle>
        <CardDescription>
          His {rows.length} game{rows.length === 1 ? "" : "s"} this season
          {stat === "pts" ? ", with tonight's prediction" : stat === "min" ? ", with the minutes the model expects" : ""}.
        </CardDescription>
        <CardAction>
          <ToggleGroup type="single" size="sm" variant="outline" value={stat} onValueChange={(v) => v && setStat(v as Stat)}>
            {(Object.keys(STATS) as Stat[]).map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-2.5 text-xs">
                {STATS[s].short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No games yet this season. The model uses last season&apos;s numbers for now.
          </div>
        ) : (
          <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-brand" /> {STATS[stat].label}
            </span>
            {avg !== null && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-muted-foreground" /> Season avg <b className="font-medium text-foreground tabular-nums">{fmt(avg)}</b>
              </span>
            )}
            {dashed && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-pred" /> {dashed.label.split(" ")[0]}{" "}
                <b className="font-medium text-pred tabular-nums">{dashed.label.split(" ")[1]}</b>
              </span>
            )}
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
                <XAxis dataKey="x" {...AXIS} interval="preserveStartEnd" minTickGap={6} />
                <YAxis {...AXIS} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
                  content={({ active, payload }) => {
                    const g = active && payload?.[0] ? (payload[0].payload as (typeof rows)[number]) : null;
                    if (!g) return null;
                    return (
                      <ChartTooltipBox title={`${shortDate(g.date)} ${g.home ? "vs" : "@"} ${g.opp}`}>
                        <TooltipRow color={stat === "pts" ? "var(--color-brand)" : undefined} label="Points" value={g.pts} />
                        <TooltipRow color={stat === "min" ? "var(--color-brand)" : undefined} label="Minutes" value={fmt(g.min)} />
                        <TooltipRow color={stat === "tsa" ? "var(--color-brand)" : undefined} label="Shot volume" value={fmt(g.tsa)} />
                      </ChartTooltipBox>
                    );
                  }}
                />
                <Bar dataKey="v" fill="var(--color-brand)" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                {avg !== null && (
                  <ReferenceLine
                    y={avg}
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={1.5}
                  />
                )}
                {dashed && (
                  <ReferenceLine
                    y={dashed.y}
                    stroke="var(--color-pred)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
