import sys, os, json, itertools
sys.path.insert(0, os.path.expanduser("~/search2"))
from run import *
R = pd.DataFrame([json.loads(l) for l in open(OUT)]).sort_values("mae")
fold = np.empty(len(d), object)
for tr, va, l in S.tasks(): fold[va] = l
fv = fold[VAL_IDX]; yv = y[VAL_IDX]
P = {cid: np.load(f"{PRED_DIR}/{cid}.npy").astype(float) for cid in R.id}
def score(p): return {l: mae(yv[fv == l], p[fv == l]) for l in ["f1", "f2", "f3", "f4"]}
hgb = [c for c in R.id if c.startswith("hgb")][:10]
hub = "huber|e=1.1|a=0.001|fs=base+prev|win=2018"
rows = []
for k in [1, 3, 5, 10]:
    avg = np.mean([P[c] for c in hgb[:k]], axis=0)
    for w in [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0]:
        p = w * avg + (1 - w) * P[hub]; s = score(p)
        rows.append({"id": f"ens|top{k}hgb|w_hgb={w}", "mae": np.mean(list(s.values())), **s})
E = pd.DataFrame(rows).sort_values("mae")
print(E.head(10).round(4).to_string())
ref = score(P[hub]); best = E.iloc[0]
print("best ens vs huber per fold:", {l: round(ref[l] - best[l], 4) for l in ref})
with open(OUT, "a") as f:
    for r in rows: f.write(json.dumps({k: (float(v) if k != "id" else v) for k, v in r.items()}) + "\n")
