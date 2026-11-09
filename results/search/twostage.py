import sys; sys.path.insert(0, "/home/claude/search")
from run import *
ym = d.MIN.values.astype(float)

def huber(cols, e=1.1, ind=False):
    return make_pipeline(lin_pre(cols, None, ind), HuberRegressor(epsilon=e, alpha=1e-3, max_iter=1000))

def inner_blocks(dates_sorted, k=4):
    return date_safe_folds(dates_sorted.reset_index(drop=True), k)

def two_stage(cid, s1_cols, s2_cols, window=2018, e=1.1, add_exp=True, s1_e=1.1):
    if cid in done: return
    per = {}; pred = np.full(len(d), np.nan); minerr = []
    for tr, va, lab in S.tasks(window):
        tri = np.where(tr)[0]
        oof = np.full(len(d), np.nan)
        for vs, ve in inner_blocks(d.GAME_DATE.iloc[tri]):
            itr = tr & (d.GAME_DATE.values < np.datetime64(vs))
            iva = tr & (d.GAME_DATE.values >= np.datetime64(vs)) & (d.GAME_DATE.values <= np.datetime64(ve))
            m1 = huber(s1_cols, s1_e).fit(d[s1_cols][itr], ym[itr]); oof[iva] = m1.predict(d[s1_cols][iva])
        m1 = huber(s1_cols, s1_e).fit(d[s1_cols][tr], ym[tr]); oof[va] = m1.predict(d[s1_cols][va])
        minerr.append(mae(ym[va], oof[va]))
        X = d[s2_cols].copy(); X["pred_min"] = oof
        cols = s2_cols + ["pred_min"]
        if add_exp:
            X["exp_pts_pred"] = d.ppm_blend * oof * d.opp_def_rtg * d.opp_pace / 1e4; cols = cols + ["exp_pts_pred"]
        tr2 = tr & ~np.isnan(oof)
        m2 = huber(cols, e, ind=True).fit(X[cols][tr2], y[tr2])
        p = np.clip(m2.predict(X[cols][va]), 0, None); pred[va] = p; per[lab] = mae(y[va], p)
    np.save(f"{PRED_DIR}/{cid}.npy", pred[VAL_IDX].astype(np.float32))
    rec = {"id": cid, "mae": float(np.mean(list(per.values()))), **per, "stage1_min_mae": float(np.mean(minerr))}
    with open(OUT, "a") as f: f.write(json.dumps(rec) + "\n")
    print(rec, flush=True)

if __name__ == "__main__":
    # minutes baseline
    mb = [mae(ym[va], d.min_l5.values[va]) for tr, va, l in S.tasks()]
    print("min_l5 baseline minutes MAE", np.mean(mb), flush=True)
    jobs = []
    for win in [2018, 2021]:
        for s2 in ["base+prev", "base+ABC"]:
            for add_exp in [True, False]:
                for e in [1.1, 1.35]:
                    jobs.append((f"twostage|huber|e={e}|fs={s2}|exp={add_exp}|win={win}", BASE, FSETS[s2][0], win, e, add_exp))
    Parallel(n_jobs=2)(delayed(two_stage)(cid, s1, s2, win, e, ax) for cid, s1, s2, win, e, ax in jobs)
