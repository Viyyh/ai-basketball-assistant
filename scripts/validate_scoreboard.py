"""Evaluate scoreboard-derived scoring changes separately from shot detection."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def sec(clock):
 m,s=clock.split(':');return int(m)*60+float(s)
rows=[]
for game,gid in [('game1','0042300401'),('game3','0042300403')]:
 truth=json.loads((ROOT/f'benchmarks/nba/{gid}.json').read_text())
 predicted=json.loads((ROOT/f'data/scoreboard/{game}.json').read_text())
 expected=[e for e in truth['events'] if e['made']]
 used=set();matches=[]
 for e in expected:
  candidates=[(abs(sec(e['clock'])-sec(p['clock'])),j,p) for j,p in enumerate(predicted['score_changes']) if j not in used and e['period']==p['period'] and e['team']==p['team'] and e['points']==p['score_delta'] and 0<=sec(e['clock'])-sec(p['clock'])<=4]
  if candidates:
   delay,j,p=min(candidates,key=lambda c:c[0]);used.add(j);matches.append({'official_id':e['id'],'video_seconds':p['video_seconds'],'clock_lag_seconds':delay})
 rows.append({'game':game,'expected_made_field_goals':len(expected),'scoreboard_changes':len(predicted['score_changes']),'matched':len(matches),'unmatched_changes':len(predicted['score_changes'])-len(used),'matches':matches,'missed_shots_not_measurable_from_scoreboard':sum(not e['made'] for e in truth['events'])})
result={'evaluation_scope':'Same selected windows only; not independent generalisation test. Scoreboard change can lag up to four game-clock seconds. Not visual shot/make recognition.','games':rows}
(ROOT/'data/final/scoreboard-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
