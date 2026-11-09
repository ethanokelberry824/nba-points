import {
  ArrowUpRight,
  BrainCircuit,
  Database,
  ExternalLink,
  GitBranch,
  HelpCircle,
  Layers,
  ShieldCheck,
  Target,
  TriangleAlert,
  User,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "How It Works",
  description: "The data, the features, and the model behind the NBA points predictor, in plain words.",
};

const PERSONAL_SITE = "https://ethanokelberry824.github.io";
const GITHUB_URL = "https://github.com/ethanokelberry824/nba-points";

const SECTIONS = [
  { id: "question", title: "The question", icon: HelpCircle },
  { id: "data", title: "The data", icon: Database },
  { id: "features", title: "The features", icon: Layers },
  { id: "leakage", title: "No peeking at the future", icon: ShieldCheck },
  { id: "models", title: "The models", icon: BrainCircuit },
  { id: "accuracy", title: "How accurate it is", icon: Target },
  { id: "limits", title: "What it can't know", icon: TriangleAlert },
  { id: "credits", title: "Who built it", icon: User },
];

const FEATURE_GROUPS = [
  {
    name: "Player form",
    count: 18,
    example: "His points per game this season, blended with last season while the sample is small, plus his last 3, 5 and 10 games.",
    items: ["points: season, last 3/5/10, blended", "minutes: same, plus the trend", "shot volume and shooting efficiency", "games played, last season's averages"],
  },
  {
    name: "Role and schedule",
    count: 7,
    example: "Playing the second night of a back to back usually means a few less minutes.",
    items: ["home or away", "days of rest, back to backs, games in the last 7 days", "games since returning from an absence, and how long it was", "starter minutes (28+ lately)"],
  },
  {
    name: "Teammates",
    count: 2,
    example: "When a 36 minute teammate sits, those shots go somewhere. This is what the who's-out switches change.",
    items: ["usual minutes of his teammates who are out", "usual minutes of opponents who are out"],
  },
  {
    name: "Opponent",
    count: 5,
    example: "A team that allows 118 points per 100 possessions and plays fast is a better night than a slow, stingy one.",
    items: ["defensive rating", "pace", "points allowed", "team strength gap (blowout risk)"],
  },
  {
    name: "Matchup history",
    count: 1,
    example: "How many points above or below his usual he scored against this team, this season and last, shrunk toward 0 when there are only a few games.",
    items: ["points vs his usual in past meetings"],
  },
];

const TRIED = [
  { name: "Simple rules (baselines)", what: "Last 5 games average, season average, blended average. Everything has to beat these.", mae: "5.237" },
  { name: "Ridge regression", what: "A straight-line formula over all 33 inputs.", mae: "4.902" },
  { name: "Huber regression", what: "Also a straight-line formula, but it isn't thrown off by rare 50 point nights.", mae: "4.866" },
  { name: "Gradient boosting", what: "Hundreds of small decision trees, each fixing the last one's mistakes.", mae: "4.862" },
  { name: "Blend (the winner)", what: "60% gradient boosting + 40% Huber. Beat each of them alone in 5 of 5 validation folds.", mae: "4.857", win: true },
];

const DIDNT_HELP = [
  "Two-stage model (predict minutes first, then points): tied, so it wasn't kept",
  "Extra combo features (expected points, usage interactions, hot streaks)",
  "Giving recent seasons more weight",
  "Predicting points above his average instead of points",
  "Other loss functions for the trees (squared error, Poisson)",
];

function Section({ id, n, title, icon: Icon, children }: { id: string; n: number; title: string; icon: typeof Target; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-ink">
              <Icon className="size-4" />
            </span>
            <h2 className="text-base font-semibold sm:text-lg">
              <span className="mr-2 text-muted-foreground tabular-nums">{n}.</span>
              {title}
            </h2>
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{children}</div>
        </CardContent>
      </Card>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">How It Works</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The data, the features and the model behind the predictions, in plain words.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="max-w-3xl space-y-4">
          <Section id="question" n={1} title="The question" icon={HelpCircle}>
            <p>
              <b>How many points will this player score against this team tonight?</b> That&apos;s a supervised regression
              problem: learn from hundreds of thousands of past games where we know the answer, then predict a game that
              hasn&apos;t happened yet.
            </p>
            <p>
              It&apos;s built the way professional projection systems work: figure out his usual scoring and minutes, then
              adjust for who&apos;s out, the opponent and the schedule. The real test is whether all that beats a simple
              rule like &quot;his average over the last 5 games&quot;.
            </p>
          </Section>

          <Section id="data" n={2} title="The data" icon={Database}>
            <p>
              Every regular season box score since 2018-19, pulled from stats.nba.com with the free <b>nba_api</b> Python
              library: one row per player per game, plus one row per team per game for the opponent numbers.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Stat value="8" label="seasons, 2018-19 to 2025-26" />
              <Stat value="~150k" label="player games" />
              <Stat value="33" label="inputs per game" />
            </div>
            <p>
              Players need to average about 15+ minutes, and games under 5 minutes (injuries, ejections) are skipped. The
              COVID seasons (the Orlando bubble, empty arenas) were kept, and testing showed they didn&apos;t hurt.
            </p>
          </Section>

          <Section id="features" n={3} title="The features" icon={Layers}>
            <p>Each game becomes 33 numbers the model can learn from, in five groups:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FEATURE_GROUPS.map((g) => (
                <div key={g.name} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{g.name}</span>
                    <Badge variant="secondary" className="tabular-nums">
                      {g.count}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs italic">{g.example}</p>
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                    {g.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p>
              The single most useful one is the <b>blended average</b>: his scoring this season, pulled toward last season
              while he has only played a few games.
            </p>
          </Section>

          <Section id="leakage" n={4} title="No peeking at the future" icon={ShieldCheck}>
            <p>
              The easiest way to fool yourself is to let a feature quietly use the game you&apos;re predicting (or later
              ones). So <b>every number only uses games before tonight</b>, including the opponent&apos;s ratings.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Leak test:</b> deleted every game after Jan 15, 2025, rebuilt everything, and checked that all 33 inputs
                for earlier games came out exactly the same. They did.
              </li>
              <li>
                <b>Match test:</b> the site builds its inputs with the same code as training. 25 random real games were
                rebuilt the site&apos;s way and matched the training data exactly.
              </li>
              <li>
                <b>Split by date:</b> training data always comes before test data, never a random shuffle.
              </li>
            </ul>
          </Section>

          <Section id="models" n={5} title="The models" icon={BrainCircuit}>
            <p>
              Each approach was tuned with time-ordered cross-validation (train on the past, check on the next stretch of
              games). Average miss on the 2025-26 test season:
            </p>
            <div className="divide-y rounded-lg border">
              {TRIED.map((t) => (
                <div key={t.name} className={t.win ? "flex items-start gap-3 bg-brand/10 p-3" : "flex items-start gap-3 p-3"}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{t.name}</div>
                    <div className={t.win ? "text-xs text-foreground/80" : "text-xs"}>{t.what}</div>
                  </div>
                  <div className="text-right">
                    <div className={t.win ? "font-semibold text-brand-ink tabular-nums" : "font-semibold text-foreground tabular-nums"}>
                      {t.mae}
                    </div>
                    <div className={t.win ? "text-[10px] text-foreground/80" : "text-[10px]"}>pts off</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="font-medium text-foreground">Tried and dropped (didn&apos;t beat the simpler version):</p>
            <ul className="list-disc space-y-1 pl-5">
              {DIDNT_HELP.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Section>

          <Section id="accuracy" n={6} title="How accurate it is" icon={Target}>
            <p>
              Tested once, at the very end, on the whole 2025-26 season (19,832 games the model never saw):
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value="4.86" label="points off, on average" />
              <Stat value="5.24" label="for the last 5 games rule" />
              <Stat value="60%" label="within 5 points" />
              <Stat value="10%" label="off by 10 or more" />
            </div>
            <p>
              That&apos;s about 7% better than the simple rule, and it held up live this season too.{" "}
              <Link href="/model-performance" className="inline-flex items-center gap-0.5 font-medium text-brand-ink hover:underline">
                See every chart on Model Performance <ArrowUpRight className="size-3.5" />
              </Link>
            </p>
          </Section>

          <Section id="limits" n={7} title="What it can't know" icon={TriangleAlert}>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <b>Injury news.</b> It has no news feed. If you know someone is out, switch them off on the Matchup page.
              </li>
              <li>
                <b>Shooting luck.</b> Even a model told his real minutes still misses by about 4.2 points. Whether the shots
                fall on a given night is mostly luck.
              </li>
              <li>
                <b>Minutes surprises.</b> Blowouts, foul trouble and coaching decisions change minutes in ways that are
                only partly predictable.
              </li>
              <li>
                <b>Big nights.</b> It predicts a typical night (between about 2 and 35 points), so it will miss the 50
                point explosions.
              </li>
            </ul>
          </Section>

          <Section id="credits" n={8} title="Who built it" icon={User}>
            <p>
              Built by <b>Ethan Okelberry</b> as the final project for Intro to AI at CSUSM, Fall 2026.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={PERSONAL_SITE}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Personal site <ExternalLink className="size-3.5" />
              </a>
              {GITHUB_URL ? (
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <GitBranch className="size-3.5" /> Code on GitHub <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-3 text-sm">
                  <GitBranch className="size-3.5" /> GitHub repo coming soon
                </span>
              )}
            </div>
            <p className="text-xs">AI tools (Claude) were used to help write the code, debug it and draft the text.</p>
          </Section>
        </div>

        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-20 space-y-1 text-sm">
            <div className="mb-2 text-xs font-medium text-muted-foreground">On this page</div>
            {SECTIONS.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="w-4 text-xs tabular-nums">{i + 1}</span>
                {s.title}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
