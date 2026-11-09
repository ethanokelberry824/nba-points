"use client";

import { BarChart3, Info, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AXIS, ChartTooltipBox, niceDomain, TooltipRow } from "@/components/charts";
import { ControlsBar } from "@/components/matchup/controls-bar";
import { ApiErrorCard, CopyLinkButton, PageHeader } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { HistoryResp, SweepOpp, SweepResp } from "@/lib/api";
import { defenseWords, fmt, ordinal, paceWords, signed } from "@/lib/format";
import { useHistory, useSweep } from "@/lib/hooks";
import { setUrlParams } from "@/lib/url-state";
import { useSelection } from "@/lib/use-selection";
import { cn } from "@/lib/utils";

type View = "chart" | "table";
const EDGE = 3; // highlight the 3 best and 3 worst

const COLOR = { best: "var(--color-pos)", worst: "var(--color-neg)", mid: "var(--color-brand)" } as const;
const tone = (i: number, n: number): keyof typeof COLOR => (i < EDGE ? "best" : i >= n - EDGE ? "worst" : "mid");

export function SweepPage() {
  const sel = useSelection();
  const { player, date, home } = sel;
  const router = useRouter();
  const [view, setView] = useState<View>("chart");
  const sweep = useSweep(player?.id ?? null, date, home);
  const { data: history } = useHistory(player?.id ?? null);

  if (sel.error) return <ApiErrorCard message={sel.error.message} onRetry={sel.retry} />;
  if (!sel.meta || !player || !date) return <SweepSkeleton />;

  const data = sweep.data && sweep.data.player.id === player.id ? sweep.data : undefined;
  const open = (oppId: number) => router.push(`/?player=${player.id}&opp=${oppId}&home=${home ? 1 : 0}&date=${date}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="vs Every Team"
        description={`${player.name}'s predicted points against all 29 opponents, with everyone playing. Click a team to open that matchup.`}
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => v && setView(v as View)}
              aria-label="Chart or table view"
            >
              <ToggleGroupItem value="chart" className="px-2.5 text-xs" aria-label="Chart view">
                <BarChart3 /> Chart
              </ToggleGroupItem>
              <ToggleGroupItem value="table" className="px-2.5 text-xs" aria-label="Table view">
                <Table2 /> Table
              </ToggleGroupItem>
            </ToggleGroup>
            <CopyLinkButton />
          </>
        }
      />

      <ControlsBar
        player={player}
        home={home}
        date={date}
        minDate={sel.minDate}
        maxDate={sel.maxDate}
        onHome={(h) => setUrlParams({ home: h ? "1" : "0" })}
        onDate={(d) => setUrlParams({ date: d })}
      />

      {sweep.error && !data ? (
        <ApiErrorCard title="Couldn't load the matchups" message={sweep.error.message} onRetry={() => sweep.mutate()} />
      ) : !data ? (
        <SweepSkeleton bare />
      ) : (
        <>
          <SummaryRow data={data} />
          {view === "chart" ? (
            <SweepChart data={data} onPick={open} updating={sweep.isValidating} />
          ) : (
            <SweepTable data={data} history={history} home={home} date={date} />
          )}
        </>
      )}
    </div>
  );
}

function SummaryRow({ data }: { data: SweepResp }) {
  const o = data.opponents;
  const best = o[0];
  const worst = o[o.length - 1];
  const items = [
    { label: "Best matchup", value: fmt(best.prediction), sub: `vs ${best.abbr}, ${defenseWords(best.opp_def_rank)}`, tone: "text-pos" },
    { label: "Toughest matchup", value: fmt(worst.prediction), sub: `vs ${worst.abbr}, ${defenseWords(worst.opp_def_rank)}`, tone: "text-neg" },
    { label: "Spread", value: fmt(best.prediction - worst.prediction), sub: "points between best and toughest", tone: "" },
    { label: "Blended average", value: fmt(data.blended_avg), sub: "his usual scoring going in", tone: "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="gap-1.5 px-4 py-4">
          <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
          <div className={cn("text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl", it.tone)}>{it.value}</div>
          <div className="text-xs text-muted-foreground">{it.sub}</div>
        </Card>
      ))}
    </div>
  );
}

function SweepChart({ data, onPick, updating }: { data: SweepResp; onPick: (oppId: number) => void; updating: boolean }) {
  const o = data.opponents;
  const avg = data.blended_avg;
  const vals = [...o.map((r) => r.prediction), ...(avg !== null ? [avg] : [])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const { d0, d1, ticks } = niceDomain(lo, hi);
  const rows = o.map((r, i) => ({ ...r, i, range: [d0, r.prediction] as [number, number], tone: tone(i, o.length) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Best to toughest matchup</CardTitle>
        <CardDescription>
          {data.home ? "Home" : "Away"} games on this date. Green = 3 best, red = 3 toughest. Click a bar to open that matchup.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-3 transition-opacity", updating && "opacity-60")}>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-pos" /> 3 best
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-brand/50" /> The rest
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-neg" /> 3 toughest
          </span>
          {avg !== null && (
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-pred" /> His blended average{" "}
              <b className="font-medium text-pred tabular-nums">{fmt(avg)}</b>
            </span>
          )}
        </div>
        <div style={{ height: rows.length * 27 + 32 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" />
              <XAxis type="number" domain={[d0, d1]} ticks={ticks} allowDataOverflow {...AXIS} />
              <YAxis yAxisId="name" type="category" dataKey="abbr" width={44} {...AXIS} interval={0} />
              <YAxis
                yAxisId="value"
                orientation="right"
                type="category"
                dataKey="i"
                width={40}
                {...AXIS}
                interval={0}
                tickFormatter={(i: number) => fmt(rows[i]?.prediction)}
                tick={{ fontSize: 12, fill: "var(--color-foreground)", fontWeight: 500 }}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const r = active && payload?.[0] ? (payload[0].payload as SweepOpp) : null;
                  if (!r) return null;
                  return (
                    <ChartTooltipBox title={r.name}>
                      <TooltipRow label="Prediction" value={fmt(r.prediction)} />
                      <TooltipRow label="Likely range" value={`${fmt(r.low)} to ${fmt(r.high)}`} />
                      <TooltipRow label="Defense" value={defenseWords(r.opp_def_rank)} />
                      <TooltipRow label="Pace" value={paceWords(r.opp_pace_rank)} />
                      <TooltipRow label="Past meetings" value={r.meetings ? `${r.meetings}, ${signed(r.pts_vs_opp_rel)} vs usual` : "none"} />
                      <p className="pt-1 text-muted-foreground">Click to open this matchup</p>
                    </ChartTooltipBox>
                  );
                }}
              />
              {avg !== null && (
                <ReferenceLine yAxisId="name" x={avg} stroke="var(--color-pred)" strokeWidth={2} strokeDasharray="5 4" ifOverflow="extendDomain" />
              )}
              <Bar
                yAxisId="name"
                dataKey="range"
                radius={3}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(_, index) => onPick(rows[index].opp_id)}
              >
                {rows.map((r) => (
                  <Cell key={r.opp_id} fill={COLOR[r.tone]} fillOpacity={r.tone === "mid" ? 0.5 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          The axis is zoomed in (it starts at {d0}, not 0) so the differences are visible. The table view lists the same
          numbers.
        </p>
      </CardContent>
    </Card>
  );
}

function SweepTable({ data, history, home, date }: { data: SweepResp; history: HistoryResp | undefined; home: boolean; date: string }) {
  const vs = new Map((history?.vs_opponents ?? []).map((v) => [v.opp_id, v]));
  const n = data.opponents.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>All 29 opponents</CardTitle>
        <CardDescription>
          Ranks are out of 30 (1 = toughest defense, 1 = fastest pace). History covers {history?.vs_opponents_seasons.join(" and ") ?? "this season and last"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-4">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Opponent</TableHead>
              <TableHead className="text-right">Prediction</TableHead>
              <TableHead className="text-right">Defense</TableHead>
              <TableHead className="text-right">Pace</TableHead>
              <TableHead className="text-right">His history vs them</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.opponents.map((r, i) => {
              const h = vs.get(r.opp_id);
              const t = tone(i, n);
              return (
                <TableRow key={r.opp_id} className="group">
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <Link
                      href={`/?player=${data.player.id}&opp=${r.opp_id}&home=${home ? 1 : 0}&date=${date}`}
                      className="flex items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          "flex h-6 min-w-9 items-center justify-center rounded px-1 text-[11px] font-bold",
                          t === "best" ? "bg-pos/15 text-pos" : t === "worst" ? "bg-neg/15 text-neg" : "bg-muted",
                        )}
                      >
                        {r.abbr}
                      </span>
                      <span className="truncate group-hover:underline">{r.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-semibold tabular-nums">{fmt(r.prediction)}</span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {fmt(r.low, 0)} to {fmt(r.high, 0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={defenseWords(r.opp_def_rank)}>
                    {ordinal(r.opp_def_rank)}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{fmt(r.opp_def_rtg)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={paceWords(r.opp_pace_rank)}>
                    {ordinal(r.opp_pace_rank)}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{fmt(r.opp_pace)}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {h ? (
                      <>
                        <span className="font-medium">{fmt(h.avg_pts)}</span>
                        <span className="text-muted-foreground"> in {h.games}</span>
                        {r.pts_vs_opp_rel !== null && r.meetings > 0 && (
                          <span className={cn("ml-1.5", (r.pts_vs_opp_rel ?? 0) >= 0 ? "text-pos" : "text-neg")}>
                            {signed(r.pts_vs_opp_rel)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">none</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          History = his average vs them, and points above or below his usual in those games (what the model sees, shrunk
          toward 0 for few meetings). The model gives past meetings very little weight.
        </p>
      </CardContent>
    </Card>
  );
}

export function SweepSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {!bare && (
        <>
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-[74px] w-full rounded-xl" />
        </>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Card>
        <CardContent className="space-y-2 py-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-5" style={{ width: `${92 - i * 4}%` }} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
