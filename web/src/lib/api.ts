/**
 * Talks to the FastAPI backend (api/main.py). Every request goes through apiFetch, which
 * also tracks "slow" requests: if one takes more than 3 seconds (the hosted API is
 * asleep and starting up), the app shows a "waking up" message instead of a blank screen.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SLOW_MS = 3000;

// ------------------------------------------------------------------ types (match api/engine.py)

export type Meta = {
  season: string;
  stats_through: string;
  built_at: string;
  test_season: string;
  test_games: number;
  test_mae: number;
  baseline_l5_mae: number;
  pct_within_3: number;
  pct_within_5: number;
  pct_off_10_plus: number;
  /** the site's model is version 2; the test_mae above is version 1's pre-committed score */
  model_version?: string;
  v2?: { test_mae: number; pct_within_3: number; pct_within_5: number; pct_off_10_plus: number; note: string };
  default_date: string;
  days_since_stats: number;
  stale_days: number;
  stale_warning: string | null;
};

export type Player = {
  id: number;
  name: string;
  team_id: number;
  team: string;
  games: number;
  ppg: number | null;
  mpg: number | null;
  last5_ppg: number | null;
  last_game: string;
};

export type Team = {
  id: number;
  abbr: string;
  name: string;
  def_rtg: number;
  def_rank: number;
  pace: number;
  pace_rank: number;
};

export type TeamsResp = { date: string; note: string; teams: Team[] };

export type RotationPlayer = {
  player_id: number;
  name: string;
  usual_min: number;
  /** usual shot attempts a game (FGA + 0.44 x FTA), version 2 */
  usual_tsa: number;
  still_on_team: boolean;
  last_game: string;
  missed_last_team_game: boolean;
  /** opponent players only. Context, NOT a model input: his team's defensive rating without him
   * minus with him, this season and last combined (+ = they defend worse without him). */
  def_delta?: number | null;
  /** def_delta * games_without / (games_without + 10): what the site shows */
  def_delta_shrunk?: number | null;
  games_without?: number;
  games_with?: number;
  /** the one "Defense without him" line for this team: biggest shrunk value among its rotation
   * players with 10+ games with him, 5+ without, shrunk >= 4 (rule in src/build_site_data.py) */
  key_defender?: boolean;
};

export type RotationTeam = {
  side: "team" | "opponent";
  team_id: number;
  abbr: string;
  name: string;
  players: RotationPlayer[];
};

export type RotationsResp = { date: string; home: boolean; note: string; teams: RotationTeam[] };

export type BreakdownFeature = { feature: string; value: number | null; neutral: number | number[] | null };
export type BreakdownStep = { key: string; label: string; change: number; features: BreakdownFeature[] };

export type PredictResp = {
  player: { id: number; name: string; team_id: number; team: string };
  opponent: { id: number; abbr: string; name: string };
  date: string;
  stale_days: number;
  stale_warning: string | null;
  home: boolean;
  team_out_ids: number[];
  opp_out_ids: number[];
  prediction: number;
  prediction_everyone_playing: number;
  likely_range: { low: number; high: number; tier: string; note: string };
  key_numbers: {
    season_avg: number | null;
    last_5_avg: number | null;
    blended_avg: number | null;
    usual_minutes: number | null;
    averages_from_last_season: boolean;
    games_played: number;
    vs_opponent: { pts_vs_opp_rel: number | null; meetings: number; note: string };
    opp_def_rtg: number;
    opp_def_rank: number;
    opp_pace: number;
    opp_pace_rank: number;
    team_missing_min: number;
    opp_missing_min: number;
    team_missing_tsa: number;
    opp_missing_tsa: number;
    rest_days: number;
  };
  low_minutes_warning: boolean;
  breakdown: {
    approximate: boolean;
    note: string;
    baseline: number;
    steps: BreakdownStep[];
    prediction: number;
  };
  features: Record<string, number | null>;
};

export type PredictBody = {
  player_id: number;
  opp_id: number;
  date: string;
  home: boolean;
  team_out_ids: number[];
  opp_out_ids: number[];
};

export type Game = {
  date: string;
  season: string;
  team: string;
  opp_id: number;
  opp: string;
  home: boolean;
  pts: number;
  min: number | null;
  tsa: number | null;
};

export type HistoryResp = {
  player: { id: number; name: string; team_id: number; team: string };
  season: string;
  season_games: Game[];
  vs_opponents_seasons: string[];
  vs_opponents: { opp_id: number; abbr: string; games: number; avg_pts: number; game_log: Game[] }[];
};

export type SweepOpp = {
  opp_id: number;
  abbr: string;
  name: string;
  prediction: number;
  low: number;
  high: number;
  opp_def_rtg: number;
  opp_def_rank: number;
  opp_pace: number;
  opp_pace_rank: number;
  opp_missing_min: number;
  opp_missing_tsa: number;
  pts_vs_opp_rel: number | null;
  meetings: number;
};

export type SweepResp = {
  player: { id: number; name: string; team_id: number; team: string };
  date: string;
  home: boolean;
  blended_avg: number | null;
  note: string;
  opponents: SweepOpp[];
};

export type GroupRow = {
  group: string;
  games: number;
  avg_points: number;
  mae_model: number;
  mae_baseline_l5: number;
  model_better_by: number;
};

export type ModelStats = {
  built_at: string;
  test_season: string;
  test_games: number;
  final_model: string;
  test_results: {
    approach: string;
    test_mae: number;
    test_rmse: number;
    test_r2: number;
    cv_mae: number;
    is_baseline: boolean;
    /** version 1 blend (the pre-committed test score) */
    is_final: boolean;
    /** version 2 blend (a second look at the test season) */
    is_v2_final?: boolean;
    version?: string;
  }[];
  accuracy: {
    mae: number;
    mae_baseline_l5: number;
    pct_within_3: number;
    pct_within_5: number;
    pct_off_10_plus: number;
    pred_min: number;
    pred_max: number;
    actual_max: number;
  };
  by_month: GroupRow[];
  by_tier: GroupRow[];
  by_role: GroupRow[];
  sample: { date: string; player: string; team: string; opp: string; predicted: number; actual: number }[];
  floor: {
    period: string;
    games: number;
    baseline_l5_mae: number;
    model_mae: number;
    cheat_actual_minutes_mae: number;
    note: string;
  };
  feature_importance: {
    method: string;
    features: { feature: string; label: string; mae_increase: number; std: number }[];
  };
  live: {
    season: string;
    model: string;
    stats_through: string;
    games: number;
    mae_model: number;
    mae_model_v1?: number;
    mae_baseline_l5: number;
    pct_within_5: number;
    weeks: {
      week: number;
      week_start: string;
      first_game: string;
      last_game: string;
      games: number;
      mae_model: number;
      mae_model_v1?: number;
      mae_baseline_l5: number;
    }[];
  };
  version_2?: Version2;
};

export type Version2 = {
  change: string;
  new_features: string[];
  cv: { mae_v1: number; mae_v2: number; folds_won: number; folds: number; rmse_v1: number; rmse_v2: number };
  test: { mae_v1: number; mae_v2: number; note: string };
  live: { mae_v1: number | null; mae_v2: number | null; mae_baseline_l5: number | null; games: number | null };
  reaves: {
    example: string;
    everyone_playing: { v1: number; v2: number };
    scenarios: { label: string; teammate_min: number; teammate_tsa: number; bump_v1: number; bump_v2: number }[];
  };
  by_shots_out: { group: string; games: number; mae_v1: number; mae_v2: number; v2_better_by: number }[];
};

// ------------------------------------------------------------------ slow-request tracker

let slowCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeSlow(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export const getSlow = () => slowCount > 0;
export const getSlowServer = () => false;

// ------------------------------------------------------------------ fetch

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let markedSlow = false;
  const timer = setTimeout(() => {
    markedSlow = true;
    slowCount += 1;
    emit();
  }, SLOW_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new ApiError("Can't reach the model API. Check that it's running.", 0);
    }
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.detail) detail = String(body.detail);
      } catch {
        /* not JSON */
      }
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    if (markedSlow) {
      slowCount -= 1;
      emit();
    }
  }
}

export const getJSON = <T,>(path: string) => apiFetch<T>(path);
export const postJSON = <T,>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  return s.toString();
}
