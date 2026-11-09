"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelStats } from "@/lib/api";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The accuracy ladder: one track, worst (more points off) on the left, best on the right.
 * Our numbers come from the "how low can it go" check (model_stats.floor, Jan to Apr 2025).
 * The pro site's number is public and fixed, so it lives here with its source.
 */
const PRO = {
  mae: 4.75,
  games: 5866,
  period: "Mar 28 to May 1, 2026",
  url: "https://statz.ai/nba/projections/accuracy",
};
const STUDY_URL = "https://doi.org/10.1007/s12197-023-09646-7";

// axis: MAE from 5.40 (left) to 3.80 (right)
const LEFT = 5.4;
const RIGHT = 3.8;
const pos = (mae: number) => ((LEFT - mae) / (LEFT - RIGHT)) * 100;

type MarkerKind = "baseline" | "model" | "pro" | "floor";
type Mark = {
  key: MarkerKind;
  label: string;
  mae: number;
  above: boolean;
  tip: React.ReactNode;
};

function MarkerGlyph({ kind, className }: { kind: MarkerKind; className?: string }) {
  if (kind === "floor") return <span className={cn("block h-7 w-[3px] rounded-full bg-foreground", className)} />;
  return (
    <span
      className={cn(
        "block rounded-full",
        kind === "baseline" && "size-3.5 bg-muted-foreground ring-2 ring-card",
        kind === "model" && "size-[18px] bg-brand ring-[3px] ring-card",
        kind === "pro" && "size-4 border-[2.5px] border-foreground bg-card",
        className,
      )}
    />
  );
}

/** A marker on the track: hover, focus or tap opens its note (which can hold a link). */
function Marker({ m, open, setOpen }: { m: Mark; open: boolean; setOpen: (k: MarkerKind | null) => void }) {
  const x = pos(m.mae);
  const align = x < 22 ? "left-0" : x > 78 ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div
      className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%` }}
      onMouseEnter={() => setOpen(m.key)}
      onMouseLeave={() => setOpen(null)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(null);
      }}
    >
      <button
        type="button"
        aria-label={`${m.label}: ${fmt(m.mae, 2)} points off. Show details`}
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onFocus={() => setOpen(m.key)}
        onClick={() => setOpen(m.key)}
      >
        <MarkerGlyph kind={m.key} />
      </button>
      {open && (
        <div
          role="note"
          className={cn(
            "absolute bottom-full mb-1 w-64 rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md",
            align,
          )}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 font-medium">
            <span>{m.label}</span>
            <span className="tabular-nums">{fmt(m.mae, 2)}</span>
          </div>
          <div className="text-muted-foreground">{m.tip}</div>
        </div>
      )}
    </div>
  );
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

export function AccuracyLadder({ s }: { s: ModelStats }) {
  const f = s.floor;
  const [open, setOpen] = useState<MarkerKind | null>(null);
  const { ref, seen } = useInView<HTMLDivElement>();

  // tap outside or Escape closes an open note (phones have no hover-out)
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, ref]);

  const closed = ((f.baseline_l5_mae - f.model_mae) / (f.baseline_l5_mae - f.cheat_actual_minutes_mae)) * 100;
  const better = ((f.baseline_l5_mae - f.model_mae) / f.baseline_l5_mae) * 100;
  const games = f.games.toLocaleString("en-US");

  const marks: Mark[] = [
    {
      key: "baseline",
      label: "Last-5 rule",
      mae: f.baseline_l5_mae,
      above: true,
      tip: `Guess his average over his last 5 games. Off by ${fmt(f.baseline_l5_mae, 2)} points a game (${f.period}, ${games} games).`,
    },
    {
      key: "model",
      label: "Our model",
      mae: f.model_mae,
      above: false,
      tip: `Our model on the same ${games} games: ${fmt(f.model_mae, 2)} points off, ${fmt(better, 0)}% better than the last-5 rule.`,
    },
    {
      key: "pro",
      label: "Pro projection site (Statz.ai)",
      mae: PRO.mae,
      above: true,
      tip: (
        <>
          Statz.ai grades every projection publicly: {fmt(PRO.mae, 2)} points off across {PRO.games.toLocaleString("en-US")} games,{" "}
          {PRO.period}. Different games and players from ours, so it&apos;s a ballpark, not a head-to-head. It likely uses
          injury news, which ours doesn&apos;t.{" "}
          <a href={PRO.url} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Source
          </a>
        </>
      ),
    },
    {
      key: "floor",
      label: "Luck floor",
      mae: f.cheat_actual_minutes_mae,
      above: false,
      tip: `A "cheating" model that is told how many minutes he really played, which nobody knows before tipoff. Still off by ${fmt(f.cheat_actual_minutes_mae, 2)}: what's left is mostly shooting luck.`,
    },
  ];

  const x0 = pos(f.baseline_l5_mae);
  const xModel = pos(f.model_mae);
  const xFloor = pos(f.cheat_actual_minutes_mae);

  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-wide uppercase">The accuracy ladder</CardDescription>
        <CardTitle className="text-lg leading-snug text-balance sm:text-xl">
          Within about a tenth of a point of a pro projection site, without injury news.
        </CardTitle>
        <CardDescription>
          Average miss in points per game. Left is worse, right is better. Hover or tap a marker for details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={ref} className="relative px-1 pt-1 pb-1 sm:px-2">
          {/* labels above the track (wide screens) */}
          <div className="relative hidden h-12 sm:block" aria-hidden>
            {marks
              .filter((m) => m.above)
              .map((m) => (
                <Label key={m.key} m={m} />
              ))}
          </div>

          {/* the track */}
          <div className="relative h-10">
            <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-muted/60" />
            {/* the gap we're trying to close: last-5 rule to the luck floor */}
            <div
              className="absolute top-1/2 h-2.5 -translate-y-1/2 bg-muted"
              style={{ left: `${x0}%`, width: `${xFloor - x0}%` }}
            />
            {/* shooting luck: past the floor */}
            <div
              className="absolute top-1/2 right-0 h-10 -translate-y-1/2 rounded-r-lg border-l border-dashed border-muted-foreground/40"
              style={{
                left: `${xFloor}%`,
                backgroundImage:
                  "repeating-linear-gradient(135deg, color-mix(in oklch, var(--color-muted-foreground) 22%, transparent) 0 2px, transparent 2px 9px)",
              }}
            />
            {/* the part we closed, fills when scrolled into view */}
            <div
              className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brand transition-[width] duration-[1400ms] ease-out motion-reduce:transition-none"
              style={{ left: `${x0}%`, width: seen ? `${xModel - x0}%` : "0%" }}
            />
            {marks.map((m) => (
              <Marker key={m.key} m={m} open={open === m.key} setOpen={setOpen} />
            ))}
          </div>

          {/* labels below the track (wide screens) */}
          <div className="relative hidden h-12 sm:block" aria-hidden>
            {marks
              .filter((m) => !m.above)
              .map((m) => (
                <Label key={m.key} m={m} />
              ))}
            <div
              className="absolute top-1 right-0 pl-3 text-right text-[11px] leading-tight text-muted-foreground"
              style={{ left: `${xFloor + 7}%` }}
            >
              Shooting luck: no model gets past here.
            </div>
          </div>

          {/* phones: the same markers as a stacked list */}
          <ul className="mt-3 grid gap-2 sm:hidden">
            {marks.map((m) => (
              <li key={m.key} className="flex items-center gap-2.5 text-sm">
                <span className="flex w-5 justify-center">
                  <MarkerGlyph kind={m.key} className={m.key === "floor" ? "h-4" : undefined} />
                </span>
                <span className="flex-1">{m.label}</span>
                <span className="font-semibold tabular-nums">{fmt(m.mae, 2)}</span>
              </li>
            ))}
            <li className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <span
                className="block h-4 w-5 rounded-sm border border-dashed border-muted-foreground/40"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, color-mix(in oklch, var(--color-muted-foreground) 22%, transparent) 0 2px, transparent 2px 6px)",
                }}
              />
              Shooting luck: no model gets past here.
            </li>
          </ul>
        </div>

        <p
          className={cn(
            "flex items-center gap-2 text-sm font-medium transition-opacity delay-700 duration-500 motion-reduce:transition-none",
            seen ? "opacity-100" : "opacity-0",
          )}
        >
          <span className="h-2.5 w-6 shrink-0 rounded-full bg-brand" aria-hidden />
          We closed {fmt(closed, 0)}% of the gap to the floor.
        </p>

        <p className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">
          A{" "}
          <a href={STUDY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-ink hover:underline">
            peer-reviewed study <ExternalLink className="size-3" />
          </a>{" "}
          found pro fantasy projections beat a last-5-games average by less than 10%. Ours beats it by {fmt(better, 0)}%.
        </p>
        <p className="text-xs text-muted-foreground">
          Our three numbers are the same {games} games ({f.period}). The pro site&apos;s number is from{" "}
          <a href={PRO.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            its public accuracy page
          </a>
          , on different games, so treat it as a ballpark.
        </p>
      </CardContent>
    </Card>
  );
}

function Label({ m }: { m: Mark }) {
  const x = pos(m.mae);
  const align = x < 15 ? "translate-x-0 text-left" : x > 85 ? "-translate-x-full text-right" : "-translate-x-1/2 text-center";
  return (
    <div className={cn("absolute w-max max-w-48", m.above ? "bottom-1" : "top-1", align)} style={{ left: `${x}%` }}>
      <div className="text-xs leading-tight text-muted-foreground">{m.label}</div>
      <div className={cn("text-base leading-tight font-semibold tabular-nums", m.key === "model" && "text-brand-ink")}>{fmt(m.mae, 2)}</div>
    </div>
  );
}
