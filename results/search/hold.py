import sys, os, json, re
sys.path.insert(0, os.path.expanduser("~/search2"))
from run import *
R = pd.DataFrame([json.loads(l) for l in open(OUT)])
R = R[~R.id.str.startswith("ens")].sort_values("mae")
hgb_top = [c for c in R.id if c.startswith("hgb")][:5]
def parse(cid):
    parts = dict(p.split("=", 1) for p in cid.split("|")[1:])
    conv = lambda v: None if v == "None" else (float(v) if re.match(r"^-?[\d.]+(e-?\d+)?$", v) else v)
    p = {k: conv(v) for k, v in parts.items()}
    for k in ["max_iter", "max_leaf_nodes", "min_samples_leaf"]: p[k] = int(p[k])
    fs, win, t, hl = p.pop("fs"), int(p.pop("win")), p.pop("t"), p.pop("hl")
    return p, HGB_FSETS[fs], win, t, hl
out = {}
def fit_pred(make, cols, win, target="pts", hl=None):
    (tr, va, _), = list(S.tasks(win, holdout=True))
    yt = y - d.pts_blend.values if target == "resid" else y
    m = make(); w = weights(tr, hl)
    if w is not None:
        last = m.steps[-1][0] if hasattr(m, "steps") else None
        m.fit(d[cols][tr], yt[tr], **({f"{last}__sample_weight": w} if last else {"sample_weight": w}))
    else: m.fit(d[cols][tr], yt[tr])
    p = m.predict(d[cols][va]) + (d.pts_blend.values[va] if target == "resid" else 0)
    return va, np.clip(p, 0, None)
va, out["ridge part1 (win2023)"] = fit_pred(lambda: make_pipeline(lin_pre(BASE), Ridge(alpha=1)), BASE, 2023)
cols = FSETS["base+prev"][0]
_, out["huber e1.1 base+prev win2018"] = fit_pred(lambda: make_pipeline(lin_pre(cols, None, True), HuberRegressor(epsilon=1.1, alpha=1e-3, max_iter=1000)), cols, 2018)
hp = []
for c in hgb_top:
    p, cl, win, t, hl = parse(c)
    _, pr = fit_pred(lambda p=p: HistGradientBoostingRegressor(random_state=42, early_stopping=False, **p), cl, win, t, hl); hp.append(pr)
out["hgb best single"] = hp[0]
out["ens top5hgb w0.7 + huber"] = 0.7 * np.mean(hp, axis=0) + 0.3 * out["huber e1.1 base+prev win2018"]
for b in ["pts_l5", "pts_season", "pts_blend"]: out["baseline " + b] = d[b].values[va]
yv = y[va]; mon = d.GAME_DATE.dt.month.values[va]
rows = []
for k, p in out.items():
    rows.append({"model": k, "holdout_MAE": mae(yv, p), **{f"m{m}": mae(yv[mon == m], p[mon == m]) for m in [1, 2, 3, 4]}})
T = pd.DataFrame(rows).sort_values("holdout_MAE"); print(T.round(4).to_string()); print("rows", va.sum())
T.to_csv("holdout.csv", index=False)
np.save("hold_preds.npy", np.vstack([out[k] for k in out])); json.dump(list(out), open("hold_keys.json", "w"))
