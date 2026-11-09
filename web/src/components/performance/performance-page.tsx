"use client";

import { Activity, FlaskConical, GraduationCap, Info, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { AXIS, ChartTooltipBox, TooltipRow } from "@/components/charts";
import { ApiErrorCard, PageHeader, Takeaway } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { GroupRow, Meta, ModelStats, Version2 } from "@/lib/api";
import { fmt, longDate, shortDate, signed } from "@/lib/format";
import { useMeta, useModelStats } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const MODEL = "var(--color-brand)";
const BASE = "var(--color-muted-foreground)";
const V2 = "var(--color-pred)";

const APPROACH_LABEL: Record<string, string> = {
  "v2 Blend (0.6 HistGB + 0.4 Huber)": "Version 2 blend",
  "Blend (0.6 HistGB + 0.4 Huber)": "Final blend (v1)",
  "HistGB (tuned)": "Gradient boosting",
  "Huber (tuned)": "Huber regression",
  "Ridge (tuned)": "Ridge regression",
  "baseline: pts_blend": "Blended average",
  "baseline: pts_season": "Season average",
  "baseline: pts_l5": "Last 5 average",
};

const n0 = (v: number) => v.toLocaleString("en-US");

function Legend({ items }: { items: { color: string; label: string; dashed?: boolean; faded?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.dashed ? (
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: it.color }} />
          ) : (
            <span className="size-2.5 rounded-[2px]" style={{ background: it.color, opacity: it.faded ? 0.5 : 1 }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ChartCard({ title, description, children, takeaway, className }: { title: string; description: React.ReactNode; children: React.ReactNode; takeaway: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex-1 space-y-3">{children}</div>
        <Takeaway>{takeaway}</Takeaway>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ KPI row

function KpiRow({ s }: { s: ModelStats }) {
  const a = s.accuracy;
  const items = [
    {
      label: `Test error, ${s.test_season}`,
      value: fmt(a.mae, 2),
      unit: "pts",
      sub: s.version_2
        ? `version 1, pre-committed (${n0(s.test_games)} games). Version 2: ${fmt(s.version_2.test.mae_v2, 2)}, a second look`
        : `average miss over ${n0(s.test_games)} games`,
      accent: true,
    },
    { label: "Last 5 games rule", value: fmt(a.mae_baseline_l5, 2), unit: "pts", sub: "the simple baseline to beat" },
    { label: "Within 5 points", value: fmt(a.pct_within_5, 0), unit: "%", sub: `${fmt(a.pct_within_3, 0)}% within 3, ${fmt(a.pct_off_10_plus, 0)}% off by 10+` },
    {
      label: `Live, ${s.live.season}${s.version_2 ? " (version 2)" : ""}`,
      value: fmt(s.live.mae_model, 2),
      unit: "pts",
      sub: `vs ${fmt(s.live.mae_baseline_l5, 2)} baseline, ${n0(s.live.games)} games`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="gap-1.5 px-4 py-4">
          <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
          <div className="flex items-baseline gap-1">
            <span className={cn("text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl", it.accent && "text-brand-ink")}>{it.value}</span>
            <span className="text-sm text-muted-foreground">{it.unit}</span>
          </div>
          <div className="text-xs text-muted-foreground">{it.sub}</div>
        </Card>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ every model on the test season

function TestResults({ s }: { s: ModelStats }) {
  const rows = s.test_results
    .filter((r) => r.version !== "v2" || r.is_v2_final)
    .sort((a, b) => a.test_mae - b.test_mae)
    .map((r, i) => ({ ...r, i, name: APPROACH_LABEL[r.approach] ?? r.approach }));
  const final = rows.find((r) => r.is_final)!;
  const l5 = rows.find((r) => r.approach === "baseline: pts_l5")!;
  const v2 = rows.find((r) => r.is_v2_final);
  const d0 = 4.5;
  return (
    <ChartCard
      title="Every model on the test season"
      description={`Average miss in points on ${s.test_season} (lower is better). Never seen during training or tuning.`}
      takeaway={
        <>
          Every model beats every simple rule. The final blend misses by {fmt(l5.test_mae - final.test_mae, 2)} points less
          than the last 5 games rule ({fmt(((l5.test_mae - final.test_mae) / l5.test_mae) * 100, 0)}% better). The models are
          close to each other, so most of the gain comes from the features, not the algorithm.
          {v2 &&
            ` Version 2 (${fmt(v2.test_mae, 3)}) was scored on this season after version 1, so its bar is a second look, not a clean test.`}
        </>
      }
    >
      <Legend
        items={[
          { color: MODEL, label: "Final model (version 1)" },
          ...(v2 ? [{ color: V2, label: "Version 2 (second look)" }] : []),
          { color: MODEL, label: "Other models", faded: true },
          { color: BASE, label: "Simple rules (baselines)", faded: true },
        ]}
      />
      <div style={{ height: rows.length * 36 + 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" />
            <XAxis type="number" domain={[d0, 5.4]} allowDataOverflow {...AXIS} ticks={[4.5, 4.7, 4.9, 5.1, 5.3]} />
            <YAxis yAxisId="n" type="category" dataKey="name" width={124} {...AXIS} interval={0} />
            <YAxis
              yAxisId="v"
              orientation="right"
              type="category"
              dataKey="i"
              width={40}
              {...AXIS}
              interval={0}
              tickFormatter={(i: number) => fmt(rows[i]?.test_mae, 2)}
              tick={{ fontSize: 12, fill: "var(--color-foreground)", fontWeight: 500 }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const r = active && payload?.[0] ? (payload[0].payload as (typeof rows)[number]) : null;
                if (!r) return null;
                return (
                  <ChartTooltipBox title={r.approach}>
                    <TooltipRow label="Test MAE" value={fmt(r.test_mae, 3)} />
                    <TooltipRow label="Test RMSE" value={fmt(r.test_rmse, 3)} />
                    <TooltipRow label="Test R²" value={fmt(r.test_r2, 3)} />
                    <TooltipRow label="Cross-validation MAE" value={fmt(r.cv_mae, 3)} />
                  </ChartTooltipBox>
                );
              }}
            />
            <Bar yAxisId="n" dataKey={(r: (typeof rows)[number]) => [d0, r.test_mae]} radius={3} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.i} fill={r.is_baseline ? BASE : r.is_v2_final ? V2 : MODEL} fillOpacity={r.is_final || r.is_v2_final ? 1 : 0.5} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ZoomNote start={d0} />
    </ChartCard>
  );
}

function ZoomNote({ start }: { start: number }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      The axis starts at {start}, not 0, so the gaps are visible.
    </p>
  );
}

// ------------------------------------------------------------------ how we tested

function Timeline({ meta, s }: { meta: Meta | undefined; s: ModelStats }) {
  const seasons = ["18-19", "19-20", "20-21", "21-22", "22-23", "23-24", "24-25", "25-26", "26-27"];
  const phase = (i: number) => (i < 7 ? "train" : i === 7 ? "test" : "live");
  const steps = [
    {
      icon: GraduationCap,
      title: "Trained on 2018-19 to 2024-25",
      body: "131,836 player games. Every setting was tuned with time-ordered cross-validation: always train on the past, check on the future.",
      color: "bg-brand-solid",
    },
    {
      icon: FlaskConical,
      title: `Tested once on ${s.test_season}`,
      body: `${n0(s.test_games)} games the model had never seen. Scored one time at the end, and no choices changed afterward.${
        s.version_2 ? " Version 2 came later, so its score on this season is a second look." : ""
      }`,
      color: "bg-pred",
    },
    {
      icon: Activity,
      title: `Live on ${s.live.season}`,
      body: `Refit on all 8 seasons, then tracked on real games as they happen (${n0(s.live.games)} so far, through ${longDate(s.live.stats_through)}).`,
      color: "bg-pos",
    },
  ];
  return (
    <ChartCard
      title="How we tested"
      description="Split by date, never at random, so the model is always predicting the future."
      takeaway={
        <>
          The test score is honest because the test season stayed locked away until the very end. The live number{" "}
          {meta ? `(${fmt(s.live.mae_model, 2)})` : ""} is a second, real-world check.
        </>
      }
    >
      <div>
        <div className="flex gap-[3px]" aria-hidden>
          {seasons.map((x, i) => (
            <div
              key={x}
              className={cn(
                "h-7 flex-1 rounded-[3px]",
                phase(i) === "train" ? "bg-brand/60" : phase(i) === "test" ? "bg-pred" : "bg-pos",
              )}
            />
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-[10px] text-muted-foreground tabular-nums">
          {seasons.map((x) => (
            <span key={x} className="flex-1 text-center">
              {x}
            </span>
          ))}
        </div>
      </div>
      <ol className="relative space-y-4 border-l pl-5">
        {steps.map((st) => (
          <li key={st.title} className="relative">
            <span className={cn("absolute top-0.5 -left-[29px] flex size-[17px] items-center justify-center rounded-full ring-4 ring-card", st.color)}>
              <st.icon className="size-2.5 text-white" />
            </span>
            <div className="text-sm font-medium">{st.title}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{st.body}</p>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ error by month / tier / role

function GroupTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
  const r = active && payload?.[0] ? (payload[0].payload as GroupRow & { name?: string }) : null;
  if (!r) return null;
  return (
    <ChartTooltipBox title={r.name ?? r.group}>
      <TooltipRow color={MODEL} label="Model" value={fmt(r.mae_model, 2)} />
      <TooltipRow color={BASE} label="Last 5 rule" value={fmt(r.mae_baseline_l5, 2)} />
      <TooltipRow label="Model better by" value={fmt(r.model_better_by, 2)} />
      <TooltipRow label="Games" value={n0(r.games)} />
    </ChartTooltipBox>
  );
}

function ByMonth({ s }: { s: ModelStats }) {
  const rows = s.by_month;
  const worst = rows.slice().sort((a, b) => b.mae_model - a.mae_model);
  const best = worst[worst.length - 1];
  return (
    <ChartCard
      title="Error by month"
      description={`Average miss in each month of ${s.test_season}.`}
      takeaway={
        <>
          Hardest in {worst[0].group} and {worst[1].group}: roles are still settling early on, and teams rest players near
          the end. Easiest in {best.group} ({fmt(best.mae_model, 2)}). The model beats the last 5 rule every month.
        </>
      }
    >
      <Legend items={[{ color: MODEL, label: "Model" }, { color: BASE, label: "Last 5 games rule", dashed: true }]} />
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey="group" {...AXIS} />
            <YAxis {...AXIS} domain={[4.4, 5.8]} ticks={[4.8, 5.2, 5.6]} tickFormatter={(v: number) => v.toFixed(1)} />
            <Tooltip content={GroupTooltip} cursor={{ stroke: "var(--color-border)" }} />
            <Line dataKey="mae_baseline_l5" stroke={BASE} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line dataKey="mae_model" stroke={MODEL} strokeWidth={2.5} dot={{ r: 3, fill: MODEL }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function GroupBars({ rows, labels, height = 150 }: { rows: GroupRow[]; labels: Record<string, string>; height?: number }) {
  const data = rows.map((r) => ({ ...r, name: labels[r.group] ?? r.group }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barGap={3} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="name" {...AXIS} interval={0} />
          <YAxis {...AXIS} domain={[0, 8]} ticks={[0, 2, 4, 6, 8]} />
          <Tooltip content={GroupTooltip} cursor={{ fill: "var(--color-muted)", opacity: 0.5 }} />
          <Bar dataKey="mae_model" fill={MODEL} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="mae_baseline_l5" fill={BASE} fillOpacity={0.45} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ByGroup({ s }: { s: ModelStats }) {
  const stars = s.by_tier[s.by_tier.length - 1];
  return (
    <ChartCard
      title="Error by player type"
      description="Average miss by scoring tier and by role (starter = 28+ minutes lately)."
      takeaway={
        <>
          Bigger scorers are harder to predict (a 25 point player has more room to miss), but that&apos;s where the model
          gains the most over the last 5 rule: {fmt(stars.model_better_by, 2)} points for 20+ scorers.
        </>
      }
    >
      <Legend items={[{ color: MODEL, label: "Model" }, { color: BASE, label: "Last 5 games rule", faded: true }]} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">By scoring tier</div>
          <GroupBars rows={s.by_tier} labels={{ "under 10 ppg": "Under 10", "10-20 ppg": "10 to 20", "20+ ppg": "20+" }} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Starter vs bench</div>
          <GroupBars rows={s.by_role} labels={{ "bench / part-time (<28 min)": "Bench", "starter (28+ min)": "Starters" }} />
        </div>
      </div>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ predicted vs actual

function PredVsActual({ s }: { s: ModelStats }) {
  const max = 60;
  const pts = s.sample.map((r) => ({ ...r, x: r.predicted, y: Math.min(r.actual, max) }));
  const above = s.sample.filter((r) => r.actual > max).length;
  return (
    <ChartCard
      title="Predicted vs actual"
      description={`${n0(s.sample.length)} random games from ${s.test_season}. Dots on the line were predicted exactly.`}
      takeaway={
        <>
          Predictions stay between {fmt(s.accuracy.pred_min)} and {fmt(s.accuracy.pred_max)}, while real games went from 0 to{" "}
          {s.accuracy.actual_max}. The model predicts a typical night, so it misses the explosions: those are the dots high
          above the line.
          {above > 0 && ` (${above} games over ${max} are drawn at ${max}.)`}
        </>
      }
    >
      <Legend items={[{ color: MODEL, label: "One game" }, { color: "var(--color-pred)", label: "Perfect prediction", dashed: true }]} />
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: -8 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, max]}
              ticks={[0, 10, 20, 30, 40, 50, 60]}
              {...AXIS}
              label={{ value: "Predicted points", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--color-chart-axis)" }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, max]}
              ticks={[0, 10, 20, 30, 40, 50, 60]}
              {...AXIS}
              label={{ value: "Actual", angle: -90, position: "insideLeft", offset: 18, fontSize: 11, fill: "var(--color-chart-axis)" }}
            />
            <ZAxis range={[14, 14]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="var(--color-pred)" strokeWidth={2} strokeDasharray="6 4" />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const r = active && payload?.[0] ? (payload[0].payload as (typeof pts)[number]) : null;
                if (!r) return null;
                return (
                  <ChartTooltipBox title={`${r.player} (${r.team})`}>
                    <TooltipRow label="Game" value={`${shortDate(r.date)} vs ${r.opp}`} />
                    <TooltipRow label="Predicted" value={fmt(r.predicted)} />
                    <TooltipRow label="Actual" value={r.actual} />
                  </ChartTooltipBox>
                );
              }}
            />
            <Scatter data={pts} fill={MODEL} fillOpacity={0.35} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ how low can it go

function Floor({ s }: { s: ModelStats }) {
  const f = s.floor;
  const rows = [
    { name: "Last 5 games rule", v: f.baseline_l5_mae, color: BASE, op: 0.5 },
    { name: "Our model", v: f.model_mae, color: MODEL, op: 1 },
    { name: "Cheating model", v: f.cheat_actual_minutes_mae, color: "var(--color-pred)", op: 1 },
  ].map((r, i) => ({ ...r, i }));
  const closed = ((f.baseline_l5_mae - f.model_mae) / (f.baseline_l5_mae - f.cheat_actual_minutes_mae)) * 100;
  return (
    <ChartCard
      title="How low can it go?"
      description={`The "cheating model" is told how many minutes he really played, which nobody knows before the game (${f.period}, ${n0(f.games)} games).`}
      takeaway={
        <>
          Even knowing his real minutes, it still misses by {fmt(f.cheat_actual_minutes_mae, 2)} points. That leftover is
          mostly shooting luck: whether the shots go in on a given night. Our model closes about {fmt(closed, 0)}% of the gap
          down to that floor; the rest is minutes surprises like injuries, blowouts and foul trouble.
        </>
      }
    >
      <div style={{ height: rows.length * 62 + 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" />
            <XAxis type="number" domain={[0, 6]} ticks={[0, 1, 2, 3, 4, 5, 6]} {...AXIS} />
            <YAxis yAxisId="n" type="category" dataKey="name" width={112} {...AXIS} interval={0} />
            <YAxis
              yAxisId="v"
              orientation="right"
              type="category"
              dataKey="i"
              width={40}
              {...AXIS}
              interval={0}
              tickFormatter={(i: number) => fmt(rows[i]?.v, 2)}
              tick={{ fontSize: 12, fill: "var(--color-foreground)", fontWeight: 500 }}
            />
            <Bar yAxisId="n" dataKey="v" radius={3} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.i} fill={r.color} fillOpacity={r.op} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ feature importance (bar list)

function Importance({ s }: { s: ModelStats }) {
  const top = s.feature_importance.features.slice(0, 12);
  const max = top[0].mae_increase;
  return (
    <ChartCard
      title="What the model relies on"
      description="How much worse the version 1 model gets (extra points of error) when one input is scrambled. Top 12 of 33."
      takeaway={
        <>
          His usual scoring does most of the work. Recent shot volume and teammates being out add real information.
          Opponent, schedule and matchup history add little once the model knows the player, because overlapping inputs
          share the credit.
        </>
      }
    >
      <ul className="space-y-1.5">
        {top.map((f) => (
          <li key={f.feature} className="grid grid-cols-[1fr_3.25rem] items-center gap-3 text-sm">
            <div className="relative h-7 overflow-hidden rounded-md">
              <div className="absolute inset-y-0 left-0 rounded-md bg-brand/20" style={{ width: `${Math.max(2, (f.mae_increase / max) * 100)}%` }} />
              <span className="relative flex h-full items-center truncate px-2" title={f.feature}>
                {f.label}
              </span>
            </div>
            <span className="text-right tabular-nums text-muted-foreground">+{fmt(f.mae_increase, 2)}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ live tracker

function Live({ s }: { s: ModelStats }) {
  const l = s.live;
  const rows = l.weeks.map((w) => ({ ...w, name: `Wk ${w.week}`, label: `Week ${w.week} (${shortDate(w.first_game)} to ${shortDate(w.last_game)})` }));
  return (
    <ChartCard
      title={`Live tracker, ${l.season}`}
      description={`Real games this season, through ${longDate(l.stats_through)}. The model was trained before any of them were played.`}
      takeaway={
        <>
          On games it has never seen, it misses by {fmt(l.mae_model, 2)} points vs {fmt(l.mae_baseline_l5, 2)} for the last
          5 rule, close to its test score. Early weeks are noisy because there are only a few games behind each player.
          {l.mae_model_v1 != null &&
            ` This is version 2's clean check: version 1 on the same games misses by ${fmt(l.mae_model_v1, 2)}.`}
        </>
      }
    >
      <Legend items={[{ color: MODEL, label: "Model" }, { color: BASE, label: "Last 5 games rule", faded: true }]} />
      <div className="h-56 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barGap={3} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
            <XAxis dataKey="name" {...AXIS} />
            <YAxis {...AXIS} domain={[0, 7]} ticks={[0, 2, 4, 6]} />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                const r = active && payload?.[0] ? (payload[0].payload as (typeof rows)[number]) : null;
                if (!r) return null;
                return (
                  <ChartTooltipBox title={r.label}>
                    <TooltipRow color={MODEL} label="Model" value={fmt(r.mae_model, 2)} />
                    {r.mae_model_v1 != null && <TooltipRow label="Version 1" value={fmt(r.mae_model_v1, 2)} />}
                    <TooltipRow color={BASE} label="Last 5 rule" value={fmt(r.mae_baseline_l5, 2)} />
                    <TooltipRow label="Games" value={n0(r.games)} />
                  </ChartTooltipBox>
                );
              }}
            />
            <Bar dataKey="mae_model" fill={MODEL} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="mae_baseline_l5" fill={BASE} fillOpacity={0.45} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ------------------------------------------------------------------ version 2

function BumpBar({ v, max, color, label }: { v: number; max: number; color: string; label: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="h-4 rounded-sm bg-muted/60">
        <div className="h-full rounded-sm" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }} />
      </div>
      <span className="text-right font-medium tabular-nums">{signed(v, 2)}</span>
    </div>
  );
}

function Version2Card({ v }: { v: Version2 }) {
  const max = Math.max(...v.reaves.scenarios.flatMap((x) => [x.bump_v1, x.bump_v2]));
  const scores = [
    { what: "Cross-validation", v1: v.cv.mae_v1, v2: v.cv.mae_v2, note: `version 2 better in ${v.cv.folds_won} of ${v.cv.folds} folds` },
    { what: "Test season, 2025-26", v1: v.test.mae_v1, v2: v.test.mae_v2, note: "version 1 = official; version 2 = second look" },
    ...(v.live.mae_v1 != null && v.live.mae_v2 != null
      ? [{ what: "Live, this season", v1: v.live.mae_v1, v2: v.live.mae_v2, note: `clean check, ${n0(v.live.games ?? 0)} games so far` }]
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-brand-ink" /> Version 2: who&apos;s out, by shots and not just minutes
        </CardTitle>
        <CardDescription>
          Version 1 knew how many minutes were missing, not whose. Version 2 adds the usual shots (field goal attempts plus
          free throw trips) of the players who are out.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="text-sm font-medium">The Reaves example</div>
          <p className="text-xs text-muted-foreground">
            How much {v.reaves.example.split(",")[0]}&apos;s prediction goes up when a 35 minute teammate sits ({v.reaves.example.split(", ").slice(1).join(", ")}).
          </p>
          {v.reaves.scenarios.map((x) => (
            <div key={x.label} className="space-y-1.5">
              <div className="text-xs font-medium">
                {x.label.startsWith("Reaves") ? "Austin Reaves out" : "Role player out"}{" "}
                <span className="font-normal text-muted-foreground">
                  ({fmt(x.teammate_min, 0)} min, {fmt(x.teammate_tsa, 0)} shots a game)
                </span>
              </div>
              <BumpBar v={x.bump_v1} max={max} color={BASE} label="Version 1" />
              <BumpBar v={x.bump_v2} max={max} color={MODEL} label="Version 2" />
            </div>
          ))}
          <Takeaway>
            Version 1 gives the same bump whoever sits. Version 2 knows a scorer&apos;s shots have to go somewhere.
          </Takeaway>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Average miss, version 1 vs 2</div>
          <div className="divide-y rounded-lg border text-sm">
            {scores.map((r) => (
              <div key={r.what} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.what}</div>
                  <div className="text-xs text-muted-foreground">{r.note}</div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-xs text-muted-foreground">{fmt(r.v1, 3)}</div>
                  <div className="font-semibold text-brand-ink">{fmt(r.v2, 3)}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {v.test.note}
          </p>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Where it helps (test season, second look)</div>
          <div className="overflow-hidden rounded-lg border text-sm">
            <table className="w-full">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Teammate shots out</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">v1</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">v2</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {v.by_shots_out.map((r) => (
                  <tr key={r.group}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {r.group}
                      <div className="text-[11px] text-muted-foreground">{n0(r.games)} games</div>
                    </th>
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmt(r.mae_v1, 2)}</td>
                    <td className="px-2 py-2 text-right">{fmt(r.mae_v2, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{signed(r.v2_better_by, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Takeaway>
            With nobody out the two versions see the same thing, so they tie. The gain shows up when a few shots are
            missing; with 30+ shots out (several players), version 1&apos;s missing minutes already flag a big night.
          </Takeaway>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ page

export function PerformancePage() {
  const stats = useModelStats();
  const { data: meta } = useMeta();
  const s = stats.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Model Performance"
        description="How accurate the model is on a full season it never saw, and on this season's games as they happen."
      />
      {stats.error ? (
        <ApiErrorCard title="Couldn't load the model stats" message={stats.error.message} onRetry={() => stats.mutate()} />
      ) : !s ? (
        <PerformanceSkeleton />
      ) : (
        <>
          <KpiRow s={s} />
          {s.version_2 && <Version2Card v={s.version_2} />}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <TestResults s={s} />
            </div>
            <div className="lg:col-span-5">
              <Timeline meta={meta} s={s} />
            </div>
            <div className="lg:col-span-7">
              <ByMonth s={s} />
            </div>
            <div className="lg:col-span-5">
              <ByGroup s={s} />
            </div>
            <div className="lg:col-span-7">
              <PredVsActual s={s} />
            </div>
            <div className="lg:col-span-5">
              <Floor s={s} />
            </div>
            <div className="lg:col-span-7">
              <Importance s={s} />
            </div>
            <div className="lg:col-span-5">
              <Live s={s} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {[7, 5, 7, 5].map((c, i) => (
          <Skeleton key={i} className={cn("h-80 rounded-xl", c === 7 ? "lg:col-span-7" : "lg:col-span-5")} />
        ))}
      </div>
    </div>
  );
}
