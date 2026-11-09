# Version 2 experiments (Nov 9, run outside the repo by Claude, scripts copied here)

Same setup as part 2a: train 2018-19 onward, 5 date-safe validation blocks over 2023-24 + 2024-25,
tuned Huber + HistGB from results/best_params.json, blend 0.6 HistGB + 0.4 Huber. 2025-26 not used.
Rule: keep a feature only if it wins 4+ of 5 folds AND the gain is bigger than noise (~0.005).

| Variant | CV MAE | Folds won | Kept? |
|---|---|---|---|
| A: current FEATURES | 4.9000 | n/a | baseline |
| B: + team_missing_tsa, opp_missing_tsa (missing teammates' shot volume) | 4.8923 | 5 of 5 vs A | YES |
| + team_missing_pts | 4.8927 | 5 of 5 vs A | no (same idea as B) |
| + team_missing_top_tsa (biggest shooter out) | 4.8948 | 5 of 5 vs A | no (worse than B) |
| + all three | 4.8903 | 4 of 5 vs B | no (0.002 over B = noise, 3 extra features) |
| B + opp_missing_blk | 4.8920 | 3 of 5 vs B | no |
| B + opp_missing_stocks (blk+stl) | 4.8921 | 4 of 5 vs B | no (0.0002 = noise) |
| B + opp_missing_dreb | 4.8918 | 3 of 5 vs B | no |
| B + opp_missing_pm (plus-minus) | 4.8924 | 2 of 5 vs B | no |
| B + opp_missing_def_delta (team def rating without vs with him, shrunk) | 4.8918 | 4 of 5 vs B | no (0.0005 = noise) |

Reaves example (model trained on all of 2018-19 to 2024-25): Luka bump when a 35-minute teammate sits.
Version 1: +0.80 regardless of who. Version 2: +1.19 if it's Reaves (18 shots a game), +0.25 if it's a 6-shot player.

Wembanyama, 2025-26 (see wemby_out.txt): opponents scored 117.5 team points without him (18 games) vs 109.8 with him (64).
Spurs allowed about +3.9 points per 100 possessions without him (def_delta, onoff_out.txt). The model can't see this:
box-score and game-level with/without defense features didn't beat noise.
