"use client";

/**
 * Tremor Raw style building blocks on top of Recharts: one tooltip look, quiet axes,
 * and a tiny sparkline for the KPI cards.
 */

import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, YAxis } from "recharts";

import { cn } from "@/lib/utils";

export const AXIS = {
  tick: { fontSize: 12, fill: "var(--color-chart-axis)" },
  axisLine: false,
  tickLine: false,
} as const;

/** Zoomed axis with even ticks: about `count` steps of 0.5 / 1 / 2 / 5 / 10... covering lo..hi plus a margin. */
export function niceDomain(lo: number, hi: number, { pad = 0.15, minPad = 1, count = 5, floor = 0 } = {}) {
  const margin = Math.max(minPad, (hi - lo) * pad);
  const a = Math.max(floor, lo - margin);
  const b = hi + margin;
  const raw = (b - a) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw) ?? 10 * pow;
  const d0 = Math.max(floor, Math.floor(a / step) * step);
  const d1 = Math.ceil(b / step) * step;
  const ticks = Array.from({ length: Math.round((d1 - d0) / step) + 1 }, (_, i) => +(d0 + i * step).toFixed(6));
  return { d0, d1, ticks };
}

export function ChartTooltipBox({ title, children, className }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-36 max-w-72 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md", className)}>
      {title && <div className="mb-1 font-medium">{title}</div>}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({ color, label, value }: { color?: string; label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color && <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function Sparkline({ data, color = "var(--color-brand)", kind = "area" }: { data: number[]; color?: string; kind?: "area" | "bar" }) {
  if (data.length < 2 && kind === "area") return <div className="h-10" />;
  const rows = data.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="h-10 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "area" ? (
          <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 2, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        ) : (
          <BarChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
            <YAxis hide domain={[0, "dataMax"]} />
            <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
