import sys, os, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
R=os.path.expanduser('~/mnt/nba-points'); sys.path.insert(0,R+'/src')
import build_features as bf
players=bf.load_logs('player'); teams=bf.load_logs('team'); tf=bf.build_team_features(teams)
# per team-game: possessions and points allowed (same possession formula as training)
t=teams.merge(teams[['GAME_ID','TEAM_ID','PTS','FGA','OREB','TOV','FTA']].rename(columns=lambda c:c if c=='GAME_ID' else 'O_'+c),on='GAME_ID')
t=t[t.TEAM_ID!=t.O_TEAM_ID]
t['POSS']=((t.FGA-t.OREB+t.TOV+0.44*t.FTA)+(t.O_FGA-t.O_OREB+t.O_TOV+0.44*t.O_FTA))/2
t=t[['TEAM_ID','SEASON','GAME_ID','GAME_DATE','POSS','O_PTS']].merge(tf[['TEAM_ID','GAME_ID','team_game_num']],on=['TEAM_ID','GAME_ID']).sort_values(['TEAM_ID','SEASON','team_game_num'])
pl=players[['PLAYER_ID','TEAM_ID','GAME_ID']].assign(on=1)
K=10
out=[]
for (team,season),g in t.groupby(['TEAM_ID','SEASON']):
    g=g.reset_index(drop=True); gids=g.GAME_ID.values
    roster=pl[pl.GAME_ID.isin(gids)&(pl.TEAM_ID==team)]
    M=roster.pivot_table(index='GAME_ID',columns='PLAYER_ID',values='on',fill_value=0).reindex(gids,fill_value=0)
    on=M.values.astype(float)
    # only count games after his first appearance for this team
    started=(np.cumsum(on,axis=0)>0).astype(float); started=np.vstack([np.zeros((1,on.shape[1])),started[:-1]]) # appeared in an EARLIER game
    off=(1-on)*started
    P=g.POSS.values[:,None]; A=g.O_PTS.values[:,None]
    def prior(x): c=np.cumsum(x,axis=0); return np.vstack([np.zeros((1,x.shape[1])),c[:-1]])
    pon,aon=prior(on*P),prior(on*A); poff,aoff=prior(off*P),prior(off*A); noff=prior(off)
    with np.errstate(divide='ignore',invalid='ignore'):
        d=100*aoff/poff-100*aon/pon   # def rating without him minus with him (+ = team defends worse without him)
    d=np.nan_to_num(d)*noff/(noff+K)
    df=pd.DataFrame(d,index=gids,columns=M.columns).stack().rename('def_delta').reset_index().rename(columns={'level_0':'GAME_ID'})
    df['TEAM_ID']=team; out.append(df)
D=pd.concat(out)
# attach to rotation players who are OUT tonight (same rotation rule as training)
cand=bf.rotation_status(players,tf); miss=cand[cand.played==0][['TEAM_ID','GAME_ID','PLAYER_ID']]
miss=miss.merge(D,on=['TEAM_ID','GAME_ID','PLAYER_ID'],how='left').fillna({'def_delta':0})
agg=miss.groupby(['TEAM_ID','GAME_ID']).def_delta.sum().rename('opp_missing_def_delta').reset_index().rename(columns={'TEAM_ID':'OPP_TEAM_ID'})
full=pd.read_pickle('full2.pkl').merge(agg,on=['OPP_TEAM_ID','GAME_ID'],how='left'); full['opp_missing_def_delta']=full.opp_missing_def_delta.fillna(0)
full.to_pickle('full3.pkl')
print(full.opp_missing_def_delta.describe().round(2).to_dict())
# Wemby check
w=players[players.PLAYER_NAME.str.contains('Wembanyama')].PLAYER_ID.iloc[0]
x=D[(D.PLAYER_ID==w)]; x=x.merge(t[['GAME_ID','TEAM_ID','SEASON','GAME_DATE']],on=['GAME_ID','TEAM_ID']).sort_values('GAME_DATE')
print('Wemby def_delta (shrunk) at end of each season:'); print(x.groupby('SEASON').def_delta.last().round(2).to_dict())
