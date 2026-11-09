import sys, os, joblib, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
R=os.path.expanduser('~/mnt/nba-points'); sys.path.insert(0,R+'/src')
F=pd.read_pickle('F_ext.pkl'); fm=joblib.load(R+'/models/final_model.joblib')
T=F[F.SEASON=='2025-26'].copy(); T['pred']=fm['model'].predict(T[fm['features']]); T['resid']=T.PTS-T.pred
P=pd.read_csv(R+'/data/raw/player_logs_2025-26.csv'); wid=P[P.PLAYER_NAME.str.contains('Wembanyama')].PLAYER_ID.iloc[0]
wg=set(P[P.PLAYER_ID==wid].GAME_ID); TL=pd.read_csv(R+'/data/raw/team_logs_2025-26.csv')
sas=set(TL[TL.TEAM_ABBREVIATION=='SAS'].GAME_ID)
vs=T[T.OPP=='SAS'].copy(); vs['wemby']=vs.GAME_ID.isin(wg)
print('Players facing SAS (2025-26, model never trained on these):')
print(vs.groupby('wemby').agg(player_games=('PTS','size'),games=('GAME_ID','nunique'),actual=('PTS','mean'),pred=('pred','mean'),avg_resid=('resid','mean'),opp_missing_min=('opp_missing_min','mean')).round(2).to_string())
# team points allowed by SAS with/without Wemby
o=TL[TL.GAME_ID.isin(sas)&(TL.TEAM_ABBREVIATION!='SAS')][['GAME_ID','PTS']]
o['wemby']=o.GAME_ID.isin(wg); print('Opponent team points vs SAS:',o.groupby('wemby').PTS.agg(['size','mean']).round(1).to_dict())
T['ob']=pd.cut(T.opp_missing_min,[-1,0,30,60,999],labels=['none','<=30','30-60','60+'])
print('League-wide avg miss (actual-pred) by opponent minutes missing:'); print(T.groupby('ob').agg(n=('PTS','size'),resid=('resid','mean'),actual_minus_usual=('PTS',lambda s:(s-T.loc[s.index,'pts_blend']).mean())).round(2).to_string())
