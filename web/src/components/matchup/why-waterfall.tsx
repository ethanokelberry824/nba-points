"use client";

import { Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AXIS, ChartTooltipBox, niceDomain, TooltipRow } from "@/components/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BreakdownFeature, PredictResp } from "@/lib/api";
import { FEATURE_INFO, fmt, signed, STEP_SHORT } from "@/lib/format";

type Row = {
  i: number;
  name: string;
  range: [number, number];
  value: number;
  kind: "total" | "final" | "up" | "down";
  label: string;
  features?: BreakdownFeature[];
};

const COLORS: Record<Row["kind"], string> = {
  total: "var(--color-muted-foreground)",
  final: "var(--color-brand)",
  up: "var(--color-pos)",
  down: "var(--color-neg)",
};

function neutralText(f: BreakdownFeature) {
  if (f.feature === "HOME") return "half home, half away";
  if (f.neutral === null || Array.isArray(f.neutral)) return "n/a";
  return FEATURE_INFO[f.feature]?.show(f.neutral) ?? fmt(f.neutral);
}

export function WhyWaterfall({ data }: { data: PredictResp | undefined }) {
  if (!data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-6" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
          ))}
        </CardContent>
      </Card>
    );
  }

  const b = data.breakdown;
  const rows: Row[] = [];
  let cum = b.baseline;
  const states = [cum];
  rows.push({ i: 0, name: "His baseline", range: [0, cum], value: cum, kind: "total", label: fmt(cum) });
  b.steps.forEach((s, j) => {
    const start = cum;
    cum += s.change;
    states.push(cum);
    rows.push({
      i: j + 1,
      name: STEP_SHORT[s.key] ?? s.label,
      range: [Math.min(start, cum), Math.max(start, cum)],
      value: s.change,
      kind: s.change >= 0 ? "up" : "down",
      label: signed(s.change),
      features: s.features,
    });
  });
  rows.push({ i: rows.length, name: "Prediction", range: [0, b.prediction], value: b.prediction, kind: "final", label: fmt(b.prediction) });

  // zoom in on where the action is, so a 0.5 point step is visible
  const lo = Math.min(...states, b.prediction);
  const hi = Math.max(...states, b.prediction);
  const { d0, d1, ticks } = niceDomain(lo, hi, { pad: 0.4, minPad: 1.5 });
  for (const r of rows) if (r.kind === "total" || r.kind === "final") r.range = [d0, r.range[1]];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Why this number</CardTitle>
        <CardDescription>
          Starts at his baseline and adds each factor back in. Hover a bar to see the numbers behind it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div style={{ height: rows.length * 38 + 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" />
              <XAxis type="number" domain={[d0, d1]} ticks={ticks} allowDataOverflow {...AXIS} />
              <YAxis yAxisId="name" type="category" dataKey="name" width={112} {...AXIS} interval={0} />
              <YAxis
                yAxisId="value"
                orientation="right"
                type="category"
                dataKey="i"
                width={44}
                {...AXIS}
                interval={0}
                tickFormatter={(i: number) => rows[i]?.label ?? ""}
                tick={{ fontSize: 12, fill: "var(--color-foreground)", fontWeight: 500 }}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const r = active && payload?.[0] ? (payload[0].payload as Row) : null;
                  if (!r) return null;
                  if (!r.features) {
                    return (
                      <ChartTooltipBox title={r.name}>
                        <TooltipRow label="Points" value={fmt(r.value)} />
                        <p className="pt-1 text-muted-foreground">
                          {r.kind === "total"
                            ? "Every factor set to neutral: average opponent, usual rest, nobody out, half home, usual form."
                            : "Baseline plus every step."}
                        </p>
                      </ChartTooltipBox>
                    );
                  }
                  return (
                    <ChartTooltipBox title={`${r.name}: ${r.label} pts`}>
                      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5">
                        <span className="text-muted-foreground" />
                        <span className="text-right text-[10px] text-muted-foreground uppercase">Tonight</span>
                        <span className="text-right text-[10px] text-muted-foreground uppercase">Neutral</span>
                        {r.features.map((f) => (
                          <div key={f.feature} className="contents">
                            <span className="text-muted-foreground">{FEATURE_INFO[f.feature]?.label ?? f.feature}</span>
                            <span className="text-right font-medium tabular-nums">
                              {f.value === null ? "n/a" : (FEATURE_INFO[f.feature]?.show(f.value) ?? fmt(f.value))}
                            </span>
                            <span className="text-right tabular-nums text-muted-foreground">{neutralText(f)}</span>
                          </div>
                        ))}
                      </div>
                    </ChartTooltipBox>
                  );
                }}
              />
              <Bar yAxisId="name" dataKey="range" radius={3} minPointSize={2} isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.i} fill={COLORS[r.kind]} fillOpacity={r.kind === "total" ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-auto space-y-1 text-xs text-muted-foreground">
          {d0 > 0 && (
            <p className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>The axis is zoomed in (it starts at {d0}, not 0) so the small changes are visible.</span>
            </p>
          )}
          <p className={d0 > 0 ? "pl-5" : ""}>
            Approximate: the steps add up to the prediction, but the model mixes factors, so a different order would split
            it a little differently.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
