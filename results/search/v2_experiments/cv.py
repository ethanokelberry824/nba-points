import sys, os, json, numpy as np, pandas as pd, warnings, time; warnings.filterwarnings('ignore')
R=os.path.expanduser('~/mnt/nba-points'); sys.path.insert(0,R+'/src')
from build_features import FEATURES
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import HuberRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from joblib import Parallel, delayed
bp=json.load(open(R+'/results/best_params.json'))
F=pd.read_pickle('F_ext.pkl')
full=F[(F.SEASON>='2018-19')&(F.SEASON<='2024-25')].sort_values('GAME_DATE',kind='stable').reset_index(drop=True)
ev=full.SEASON.isin(['2023-24','2024-25']).to_numpy(); dates=full.GAME_DATE.to_numpy()
ed=full.loc[ev,'GAME_DATE'].sort_values().reset_index(drop=True); size=len(ed)//6
starts=[ed.iloc[k*size].to_datetime64() for k in range(1,6)]; bounds=starts+[(ed.max()+pd.Timedelta(days=1)).to_datetime64()]
folds=[(np.where(dates<s)[0],np.where(ev&(dates>=s)&(dates<e))[0]) for s,e in zip(bounds[:-1],bounds[1:])]
y=full.PTS.values
V={'A_base':FEATURES,'B_shots':FEATURES+['team_missing_tsa','opp_missing_tsa'],'C_pts':FEATURES+['team_missing_pts'],
   'D_top':FEATURES+['team_missing_top_tsa'],'E_all':FEATURES+['team_missing_tsa','opp_missing_tsa','team_missing_pts','team_missing_top_tsa']}
def pre(cols): return ColumnTransformer([("num",make_pipeline(SimpleImputer(strategy="median",add_indicator=True),StandardScaler()),cols)])
def run(kind,cols,tr,va):
    m=make_pipeline(pre(cols),HuberRegressor(**bp['huber'])) if kind=='huber' else make_pipeline(pre(cols),HistGradientBoostingRegressor(**bp['hgb']))
    return m.fit(full[cols].iloc[tr],y[tr]).predict(full[cols].iloc[va])
for name in sys.argv[1:]:
    t=time.time(); cols=V[name]
    for kind in ['huber','hgb']:
        if os.path.exists(f'{name}_{kind}.npy'): continue
        P=Parallel(n_jobs=4 if kind=='huber' else 2)(delayed(run)(kind,cols,tr,va) for tr,va in folds)
        np.save(f'{name}_{kind}.npy',np.concatenate(P))
    print(name,'done',round(time.time()-t),'s',flush=True)
np.save('val_idx.npy',np.concatenate([va for _,va in folds])); np.save('fold_id.npy',np.concatenate([[k]*len(va) for k,(_,va) in enumerate(folds)]))
full.to_pickle('full.pkl')
