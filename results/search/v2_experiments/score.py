import numpy as np, pandas as pd
full=pd.read_pickle('full.pkl'); vi=np.load('val_idx.npy'); fid=np.load('fold_id.npy')
y=full.PTS.values[vi]; star=(full.pts_blend.values[vi]>=20); bigout=(full.team_missing_top_tsa.values[vi]>=12)
w=0.6; rows={}
for n in ['A_base','B_shots','C_pts','D_top','E_all']:
    p=w*np.load(f'{n}_hgb.npy')+(1-w)*np.load(f'{n}_huber.npy'); e=np.abs(y-p)
    rows[n]={**{f'f{k+1}':e[fid==k].mean() for k in range(5)},'MAE':np.mean([e[fid==k].mean() for k in range(5)]),
             'stars':e[star].mean(),'stars_bigshooter_out':e[star&bigout].mean(),'n':int((star&bigout).sum()),'bias_stars_bigout':(y-p)[star&bigout].mean()}
T=pd.DataFrame(rows).T; fc=[f'f{k}' for k in range(1,6)]
T['folds_beating_A']=[int((T.loc[n,fc]<T.loc['A_base',fc]).sum()) for n in T.index]
print(T.round(4).to_string())
