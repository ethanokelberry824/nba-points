import sys, os, json, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
R=os.path.expanduser('~/mnt/nba-points'); sys.path.insert(0,R+'/src')
from build_features import FEATURES
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import HuberRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
bp=json.load(open(R+'/results/best_params.json'))
full=pd.read_pickle('full.pkl'); y=full.PTS.values
def pre(c): return ColumnTransformer([("num",make_pipeline(SimpleImputer(strategy="median",add_indicator=True),StandardScaler()),c)])
B=FEATURES+['team_missing_tsa','opp_missing_tsa']
mods={}
for n,c in [('A',FEATURES),('B',B)]:
    mods[n]=(c,make_pipeline(pre(c),HuberRegressor(**bp['huber'])).fit(full[c],y),make_pipeline(pre(c),HistGradientBoostingRegressor(**bp['hgb'])).fit(full[c],y))
pred=lambda n,X: 0.6*mods[n][2].predict(X[mods[n][0]])+0.4*mods[n][1].predict(X[mods[n][0]])
F=pd.read_pickle('F_ext.pkl')
luka=F[(F.PLAYER_NAME.str.contains('Luka Don'))&(F.TEAM=='LAL')&(F.team_missing_min==0)].tail(1)
P=pd.read_csv(R+'/data/raw/player_logs_2025-26.csv'); ar=P[P.PLAYER_NAME=='Austin Reaves']
r_min=ar.MIN.mean(); r_tsa=(ar.FGA+0.44*ar.FTA).mean()
print(f'Reaves usual: {r_min:.1f} min, {r_tsa:.1f} shot attempts')
X0=luka.copy(); X1=luka.copy(); X1['team_missing_min']+=r_min; X1['team_missing_tsa']+=r_tsa
for n in ['A','B']: print(n,'Luka everyone playing',round(pred(n,X0)[0],2),'| Reaves out',round(pred(n,X1)[0],2),'| bump',round(pred(n,X1)[0]-pred(n,X0)[0],2))
X2=luka.copy(); X2['team_missing_min']+=r_min; X2['team_missing_tsa']+=6
print('B: 36-min low-usage teammate out (6 shots) bump',round(pred('B',X2)[0]-pred('B',X0)[0],2))
