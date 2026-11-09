"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HistoryResp, PredictResp } from "@/lib/api";
import { fmt, lastName, shortDate, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MatchupHistory({ history, data, oppId }: { history: HistoryResp | undefined; data: PredictResp | undefined; oppId: number }) {
  if (!history || !data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const vs = history.vs_opponents.find((v) => v.opp_id === oppId);
  const games = (vs?.game_log ?? []).slice().reverse();
  const rel = data.key_numbers.vs_opponent;
  const seasons = history.vs_opponents_seasons.join(" and ");
  const matchupStep = data.breakdown.steps.find((s) => s.key === "matchup");

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          {lastName(data.player.name)} vs {data.opponent.abbr}
        </CardTitle>
        <CardDescription>His games against them in {seasons}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {games.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
            No meetings in {seasons}, so history doesn&apos;t move the prediction.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Average</div>
                <div className="text-lg font-semibold tabular-nums">
                  {fmt(vs?.avg_pts)} <span className="text-xs font-normal text-muted-foreground">in {games.length}</span>
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">vs his usual</div>
                <div
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    (rel.pts_vs_opp_rel ?? 0) > 0 ? "text-pos" : (rel.pts_vs_opp_rel ?? 0) < 0 ? "text-neg" : "",
                  )}
                >
                  {signed(rel.pts_vs_opp_rel)}
                </div>
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Pts</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Shots</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {games.map((g) => (
                    <TableRow key={g.date}>
                      <TableCell className="whitespace-nowrap">
                        {shortDate(g.date)}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {g.season.slice(2)} {g.home ? "home" : "away"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{g.pts}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(g.min, 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(g.tsa)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              &quot;vs his usual&quot; = points above or below his season average going into these games, shrunk toward 0
              when there are few meetings ({rel.meetings} count). Effect on tonight&apos;s number:{" "}
              <span className="font-medium text-foreground tabular-nums">{signed(matchupStep?.change ?? null)} pts</span>
              {Math.abs(matchupStep?.change ?? 0) < 0.1 ? ". The model learned that past meetings barely predict the next one." : "."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
