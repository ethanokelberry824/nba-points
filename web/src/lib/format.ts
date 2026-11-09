export const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "n/a" : v.toFixed(d);

/** +0.6 / -1.2 / 0.0 */
export const signed = (v: number | null | undefined, d = 1) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  const r = Number(v.toFixed(d));
  if (r === 0) return (0).toFixed(d);
  return `${r > 0 ? "+" : ""}${r.toFixed(d)}`;
};

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "8th toughest defense" / "5th weakest defense" (rank 1 = toughest, of 30). */
export const defenseWords = (rank: number, teams = 30) =>
  rank <= teams / 2 ? `${rank === 1 ? "" : ordinal(rank) + " "}toughest defense`.trim()
    : `${rank === teams ? "" : ordinal(teams + 1 - rank) + " "}weakest defense`.trim();

/** "5th fastest pace" / "3rd slowest pace" (rank 1 = fastest). */
export const paceWords = (rank: number, teams = 30) =>
  rank <= teams / 2 ? `${rank === 1 ? "" : ordinal(rank) + " "}fastest pace`.trim()
    : `${rank === teams ? "" : ordinal(teams + 1 - rank) + " "}slowest pace`.trim();

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const shortDate = (iso: string) =>
  parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const longDate = (iso: string) =>
  parseDay(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export const weekdayDate = (iso: string) =>
  parseDay(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export const addDays = (iso: string, n: number) => {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const initials = (name: string) => {
  const parts = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** "Austin Reaves" -> "Reaves", "Jaren Jackson Jr." -> "Jackson Jr." */
export const lastName = (name: string) => {
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
};

export const listWords = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ------------------------------------------------------------------ feature names for the breakdown hover

type FeatureInfo = { label: string; show: (v: number) => string };
const yesNo = (v: number) => (v >= 0.5 ? "yes" : "no");
const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export const FEATURE_INFO: Record<string, FeatureInfo> = {
  opp_def_rtg: { label: "Opponent defensive rating", show: (v) => fmt(v) },
  opp_pace: { label: "Opponent pace", show: (v) => fmt(v) },
  opp_pts_allowed: { label: "Opponent points allowed", show: (v) => fmt(v) },
  net_rtg_gap: { label: "Team strength gap", show: (v) => signed(v) },
  abs_net_rtg_gap: { label: "Blowout risk (size of gap)", show: (v) => fmt(v) },
  rest_days: { label: "Rest days", show: (v) => fmt(v, 0) },
  back_to_back: { label: "Back to back", show: yesNo },
  games_last_7: { label: "Games in last 7 days", show: (v) => fmt(v, 0) },
  team_missing_min: { label: "Teammate minutes missing", show: (v) => fmt(v) },
  opp_missing_min: { label: "Opponent minutes missing", show: (v) => fmt(v) },
  team_missing_tsa: { label: "Teammate shots missing", show: (v) => fmt(v) },
  opp_missing_tsa: { label: "Opponent shots missing", show: (v) => fmt(v) },
  HOME: { label: "Home game", show: yesNo },
  pts_l3: { label: "Points, last 3", show: (v) => fmt(v) },
  pts_l5: { label: "Points, last 5", show: (v) => fmt(v) },
  pts_l10: { label: "Points, last 10", show: (v) => fmt(v) },
  min_l3: { label: "Minutes, last 3", show: (v) => fmt(v) },
  min_l5: { label: "Minutes, last 5", show: (v) => fmt(v) },
  min_l10: { label: "Minutes, last 10", show: (v) => fmt(v) },
  min_trend: { label: "Minutes trend", show: (v) => signed(v) },
  tsa_l5: { label: "Shot attempts, last 5", show: (v) => fmt(v) },
  ts_hot: { label: "Shooting vs his season", show: pct },
  starter_proxy: { label: "Starter minutes (28+)", show: yesNo },
  pts_vs_opp_rel: { label: "Past meetings vs his usual", show: (v) => signed(v) },
};

export const STEP_SHORT: Record<string, string> = {
  opponent: "Opponent",
  schedule: "Rest and schedule",
  players_out: "Players out",
  home: "Home or away",
  form: "Recent form",
  matchup: "Past meetings",
};
