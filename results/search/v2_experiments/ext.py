import sys, os, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
R=os.path.expanduser('~/mnt/nba-points'); sys.path.insert(0,R+'/src')
import build_features as bf
players=bf.load_logs('player'); teams=bf.load_logs('team')
tf=bf.build_team_features(teams)
p=players[["PLAYER_ID","TEAM_ID","SEASON","GAME_ID","GAME_DATE","MIN","PTS","FGA","FTA"]].copy()
p["TSA"]=p.FGA+0.44*p.FTA
p=p.sort_values(["PLAYER_ID","GAME_DATE"])
g=p.groupby(["PLAYER_ID","SEASON"])
for c,n in [("MIN","avg_min_thru"),("TSA","avg_tsa_thru"),("PTS","avg_pts_thru")]:
    p[n]=g[c].transform(lambda s: s.expanding().mean())
sched=tf[["TEAM_ID","SEASON","GAME_ID","team_game_num"]]
p=p.merge(sched,on=["TEAM_ID","SEASON","GAME_ID"])
cand=pd.concat([p.assign(target_num=p.team_game_num+k) for k in range(1,bf.ROTATION_LOOKBACK+1)])
cand=cand.sort_values("team_game_num").drop_duplicates(["TEAM_ID","SEASON","target_num","PLAYER_ID"],keep="last")
cand=cand[["TEAM_ID","SEASON","target_num","PLAYER_ID","avg_min_thru","avg_tsa_thru","avg_pts_thru"]].merge(sched.rename(columns={"team_game_num":"target_num"}),on=["TEAM_ID","SEASON","target_num"])
played=p[["TEAM_ID","GAME_ID","PLAYER_ID"]].assign(played=1)
cand=cand.merge(played,on=["TEAM_ID","GAME_ID","PLAYER_ID"],how="left")
cand=cand[(cand.played.isna())&(cand.avg_min_thru>=bf.MIN_AVG_MINUTES)].sort_values(["TEAM_ID","GAME_ID","PLAYER_ID"])
miss=cand.groupby(["TEAM_ID","GAME_ID"]).agg(mm=("avg_min_thru","sum"),mt=("avg_tsa_thru","sum"),mp=("avg_pts_thru","sum"),mx=("avg_tsa_thru","max")).reset_index()
F=pd.read_csv(R+'/data/processed/features.csv',parse_dates=['GAME_DATE'])
tid=players[["PLAYER_ID","GAME_ID","TEAM_ID"]]
F=F.merge(tid,on=["PLAYER_ID","GAME_ID"],how="left")
opp=teams[["GAME_ID","TEAM_ID"]].rename(columns={"TEAM_ID":"OPP_TEAM_ID"})
F=F.merge(opp,on="GAME_ID"); F=F[F.TEAM_ID!=F.OPP_TEAM_ID]
F=F.merge(miss.rename(columns={"mm":"chk_min","mt":"team_missing_tsa","mp":"team_missing_pts","mx":"team_missing_top_tsa"}),on=["TEAM_ID","GAME_ID"],how="left")
F=F.merge(miss[["TEAM_ID","GAME_ID","mt"]].rename(columns={"TEAM_ID":"OPP_TEAM_ID","mt":"opp_missing_tsa"}),on=["OPP_TEAM_ID","GAME_ID"],how="left")
for c in ["chk_min","team_missing_tsa","team_missing_pts","team_missing_top_tsa","opp_missing_tsa"]: F[c]=F[c].fillna(0)
print('rows',len(F),'| chk matches team_missing_min:',np.allclose(F.chk_min,F.team_missing_min))
print(F[['team_missing_min','team_missing_tsa','team_missing_pts','team_missing_top_tsa']].describe().round(1).T[['mean','max']])
F.to_pickle('F_ext.pkl')
