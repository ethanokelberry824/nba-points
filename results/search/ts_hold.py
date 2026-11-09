import sys; sys.path.insert(0, "/home/claude/search")
from twostage import *
(tr, va, _), = list(S.tasks(2018, holdout=True))
s2 = FSETS["base+prev"][0]
tri = np.where(tr)[0]; oof = np.full(len(d), np.nan)
for vs, ve in inner_blocks(d.GAME_DATE.iloc[tri]):
    itr = tr & (d.GAME_DATE.values < np.datetime64(vs)); iva = tr & (d.GAME_DATE.values >= np.datetime64(vs)) & (d.GAME_DATE.values <= np.datetime64(ve))
    oof[iva] = huber(BASE).fit(d[BASE][itr], ym[itr]).predict(d[BASE][iva])
oof[va] = huber(BASE).fit(d[BASE][tr], ym[tr]).predict(d[BASE][va])
X = d[s2].copy(); X["pred_min"] = oof; X["exp_pts_pred"] = d.ppm_blend * oof * d.opp_def_rtg * d.opp_pace / 1e4
cols = s2 + ["pred_min", "exp_pts_pred"]; tr2 = tr & ~np.isnan(oof)
p = np.clip(huber(cols, ind=True).fit(X[cols][tr2], y[tr2]).predict(X[cols][va]), 0, None)
one = np.clip(huber(s2, ind=True).fit(d[s2][tr], y[tr]).predict(d[s2][va]), 0, None)
mon = d.GAME_DATE.dt.month.values[va]; yv = y[va]
for name, q in [("two-stage huber", p), ("one-stage huber", one)]:
    print(name, round(mae(yv, q), 4), [round(mae(yv[mon == m], q[mon == m]), 4) for m in [1, 2, 3, 4]])
print("stage1 minutes MAE", round(mae(ym[va], oof[va]), 3), " min_l5 baseline", round(mae(ym[va], d.min_l5.values[va]), 3))
