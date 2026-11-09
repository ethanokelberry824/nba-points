"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";

import {
  getJSON,
  getSlow,
  getSlowServer,
  postJSON,
  qs,
  subscribeSlow,
  type HistoryResp,
  type Meta,
  type ModelStats,
  type Player,
  type PredictBody,
  type PredictResp,
  type RotationsResp,
  type SweepResp,
  type TeamsResp,
} from "@/lib/api";

const STATIC = { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 60_000 };

export const useMeta = () => useSWR<Meta>("/meta", getJSON, STATIC);
export const usePlayers = () => useSWR<Player[]>("/players", getJSON, STATIC);

export const useTeams = (date: string | null) =>
  useSWR<TeamsResp>(date ? `/teams?${qs({ date })}` : null, getJSON, STATIC);

export const useHistory = (playerId: number | null) =>
  useSWR<HistoryResp>(playerId ? `/history?${qs({ player_id: playerId })}` : null, getJSON, STATIC);

export const useRotations = (playerId: number | null, oppId: number | null, date: string | null, home: boolean) =>
  useSWR<RotationsResp>(
    playerId && oppId && date ? `/rotations?${qs({ player_id: playerId, opp_id: oppId, date, home })}` : null,
    getJSON,
    { ...STATIC, keepPreviousData: true },
  );

export const usePredict = (body: PredictBody | null) =>
  useSWR<PredictResp>(
    body ? ["/predict", JSON.stringify(body)] : null,
    ([path, b]: [string, string]) => postJSON<PredictResp>(path, JSON.parse(b)),
    { ...STATIC, keepPreviousData: true, shouldRetryOnError: false },
  );

export const useSweep = (playerId: number | null, date: string | null, home: boolean) =>
  useSWR<SweepResp>(
    playerId && date ? `/sweep?${qs({ player_id: playerId, date, home })}` : null,
    getJSON,
    { ...STATIC, keepPreviousData: true },
  );

export const useModelStats = () => useSWR<ModelStats>("/model-stats", getJSON, STATIC);

/** True while any API request has been running for more than 3 seconds (cold start). */
export const useSlowRequests = () => useSyncExternalStore(subscribeSlow, getSlow, getSlowServer);

/** The value, but only after it stops changing for `ms` (rapid switch flips -> one request). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
