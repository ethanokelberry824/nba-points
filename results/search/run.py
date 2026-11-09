import sys, os, json, time, itertools, random
sys.path.insert(0, os.path.expanduser("~/search2"))
from lib import *
from scipy.stats import loguniform
from joblib import Parallel, delayed

d = load(); S = Split(d); y = d.PTS.values.astype(float)
OUT = "results.jsonl"; PRED_DIR = "preds"; os.makedirs(PRED_DIR, exist_ok=True)
done = set()
if os.path.exists(OUT):
    for line in open(OUT): done.add(json.loads(line)["id"])
VAL_MASK = np.zeros(len(d), bool)
for tr, va, l in S.tasks(): VAL_MASK |= va
VAL_IDX = np.where(VAL_MASK)[0]

EXTRA_A = ["exp_pts", "exp_pts_l5", "ppm_blend"]
EXTRA_B = ["miss_x_pts", "miss_x_min"]
EXTRA_C = ["pts_l5_minus_blend", "min_l5_minus_blend"]
SPL = ["games_played", "rest_days", "abs_net_rtg_gap", "games_since_return", "min_trend", "ts_hot"]
FSETS = {
    "base": (BASE, None, False),
    "base+prev": (BASE + PREV, None, True),
    "base+A": (BASE + EXTRA_A, None, False),
    "base+B": (BASE + EXTRA_B, None, False),
    "base+ABC": (BASE + EXTRA_A + EXTRA_B + EXTRA_C, None, False),
    "base+spl": (BASE, SPL, False),
    "all+spl": (BASE + PREV + EXTRA_A + EXTRA_B + EXTRA_C, SPL, True),
}
HGB_FSETS = {"base": BASE, "base+prev": BASE + PREV, "all": BASE + PREV + EXTRA_A + EXTRA_B + EXTRA_C}

def weights(tr_mask, half_life):
    if not half_life: return None
    s = d.season_idx.values[tr_mask]
    return 0.5 ** ((s.max() - s) / half_life)

def run_cfg(cid, make_model, cols, window, target="pts", half_life=None, extra_cols_fn=None):
    if cid in done: return None
    t = time.time(); per = {}; pred = np.full(len(d), np.nan)
    for tr, va, lab in S.tasks(window):
        X = d[cols]
        if extra_cols_fn: X = extra_cols_fn(X, tr, va)
        yt = y - d.pts_blend.values if target == "resid" else y
        m = make_model()
        w = weights(tr, half_life)
        kw = {}
        if w is not None:
            last = m.steps[-1][0] if hasattr(m, "steps") else None
            kw = {f"{last}__sample_weight": w} if last else {"sample_weight": w}
        m.fit(X[tr], yt[tr], **kw)
        p = m.predict(X[va]) + (d.pts_blend.values[va] if target == "resid" else 0)
        p = np.clip(p, 0, None)
        pred[va] = p; per[lab] = mae(y[va], p)
    np.save(f"{PRED_DIR}/{cid}.npy", pred[VAL_IDX].astype(np.float32))
    rec = {"id": cid, "mae": float(np.mean(list(per.values()))), **per, "secs": round(time.time() - t, 1)}
    with open(OUT, "a") as f: f.write(json.dumps(rec) + "\n")
    return rec

def baselines():
    for col in ["pts_l5", "pts_season", "pts_blend"]:
        cid = f"baseline|{col}"
        if cid in done: continue
        per = {}; pred = np.full(len(d), np.nan)
        for tr, va, lab in S.tasks():
            pred[va] = d[col].values[va]; per[lab] = mae(y[va], pred[va])
        np.save(f"{PRED_DIR}/{cid}.npy", pred[VAL_IDX].astype(np.float32))
        with open(OUT, "a") as f: f.write(json.dumps({"id": cid, "mae": float(np.mean(list(per.values()))), **per}) + "\n")

def linear_jobs():
    jobs = []
    for fs, (cols, spl, ind) in FSETS.items():
        for win in [2023, 2021, 2018]:
            for a in [0.1, 1, 10, 100, 1000]:
                jobs.append((f"ridge|a={a}|fs={fs}|win={win}", (lambda a=a, cols=cols, spl=spl, ind=ind:
                             make_pipeline(lin_pre(cols, spl, ind), Ridge(alpha=a))), cols, win))
            for e in [1.1, 1.35, 1.6, 2.0]:
                for a in [1e-4, 1e-3, 1e-2]:
                    jobs.append((f"huber|e={e}|a={a}|fs={fs}|win={win}", (lambda e=e, a=a, cols=cols, spl=spl, ind=ind:
                                 make_pipeline(lin_pre(cols, spl, ind), HuberRegressor(epsilon=e, alpha=a, max_iter=1000))), cols, win))
    return jobs

def hgb_jobs(n, seed=0):
    rng = random.Random(seed); jobs = []
    for i in range(n):
        p = dict(loss=rng.choice(["squared_error", "absolute_error", "poisson"]),
                 learning_rate=round(float(loguniform(0.01, 0.2).rvs(random_state=rng.randint(0, 10**6))), 4),
                 max_iter=rng.choice([200, 400, 700, 1000]),
                 max_leaf_nodes=rng.choice([7, 15, 31, 63]),
                 min_samples_leaf=rng.choice([20, 50, 100, 200, 400]),
                 l2_regularization=round(float(loguniform(1e-3, 10).rvs(random_state=rng.randint(0, 10**6))), 4),
                 max_features=rng.choice([0.5, 0.7, 1.0]))
        fs = rng.choice(list(HGB_FSETS)); win = rng.choice([2023, 2023, 2021, 2018])
        target = rng.choice(["pts", "resid"]); hl = rng.choice([None, None, 1, 2]) if win < 2023 else None
        if p["loss"] == "poisson": target = "pts"
        cid = "hgb|" + "|".join(f"{k}={v}" for k, v in p.items()) + f"|fs={fs}|win={win}|t={target}|hl={hl}"
        jobs.append((cid, p, HGB_FSETS[fs], win, target, hl))
    return jobs

def hgb_focus_jobs(n, seed=100):
    rng = random.Random(seed); jobs = []
    for i in range(n):
        p = dict(loss="absolute_error",
                 learning_rate=round(rng.uniform(0.01, 0.06), 4),
                 max_iter=rng.choice([600, 900]),
                 max_leaf_nodes=rng.choice([5, 7, 11, 15]),
                 min_samples_leaf=rng.choice([100, 200, 300, 500]),
                 l2_regularization=round(float(loguniform(0.01, 5).rvs(random_state=rng.randint(0, 10**6))), 4),
                 max_features=rng.choice([0.3, 0.5, 0.7]))
        fs = rng.choice(["base+prev", "all"]); win = rng.choice([2021, 2021, 2018])
        target = rng.choice(["pts", "resid"]); hl = rng.choice([None, 1, 2, 3])
        cid = "hgb|" + "|".join(f"{k}={v}" for k, v in p.items()) + f"|fs={fs}|win={win}|t={target}|hl={hl}"
        jobs.append((cid, p, HGB_FSETS[fs], win, target, hl))
    return jobs

if __name__ == "__main__":
    phase = sys.argv[1]
    if phase == "base": baselines()
    if phase == "linbest":
        for e, fs, win in [(1.1, "base+prev", 2018), (1.1, "base", 2018), (1.1, "base+prev", 2021)]:
            cols, spl, ind = FSETS[fs]
            run_cfg(f"huber|e={e}|a=0.001|fs={fs}|win={win}", lambda: make_pipeline(lin_pre(cols, spl, ind), HuberRegressor(epsilon=e, alpha=1e-3, max_iter=1000)), cols, win)
        run_cfg("ridge|a=1|fs=base|win=2023", lambda: make_pipeline(lin_pre(BASE), Ridge(alpha=1)), BASE, 2023)
        baselines()
    if phase == "linear":
        Parallel(n_jobs=2)(delayed(run_cfg)(cid, mk, cols, win) for cid, mk, cols, win in linear_jobs())
    if phase in ("hgb", "hgb2"):
        T0 = time.time(); budget = float(os.environ.get("BUDGET", "140"))
        gen = hgb_jobs if phase == "hgb" else hgb_focus_jobs
        for cid, p, cols, win, target, hl in gen(int(sys.argv[2])):
            if cid in done: continue
            if time.time() - T0 > budget: print("budget hit"); break
            run_cfg(cid, lambda p=p: HistGradientBoostingRegressor(random_state=42, early_stopping=False, **p),
                    cols, win, target, hl)
    print("phase done", phase)
