"""Audit all external annotations without claiming unobserved visual accuracy."""
import json,re,sqlite3,hashlib,unicodedata
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
LABELS={'Dribble','PassBall','Steal','Layup','Hold','3ptShot','DefensiveRebound','2ptShot','HandOff','Block','FreeThrow','JumpBall','OffensiveRebound','InboundPass','PutBack','Dunk'}
SHOTS={'Layup':2,'2ptShot':2,'3ptShot':3,'PutBack':2,'Dunk':2}
def name(value):return ''.join(c for c in unicodedata.normalize('NFKD',str(value)).casefold() if c.isalnum())
def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
def normalize_label(value):return 'PutBack' if value=='Putback' else 'unknown' if value in [None,'nan',''] else value
def time_pair(value):
 if not isinstance(value,str) or not re.fullmatch(r'\d+:\d{2}',value):return None
 return tuple(map(int,value.split(':')))
def audit(record):
 normalized=json.loads(canonical(record));flags=[];ids=set();previous=None
 if not isinstance(record.get('events'),list) or not record['events']:flags.append({'code':'missing_events','severity':'error'})
 for index,e in enumerate(normalized.get('events',[])):
  def flag(code,severity='warning'):flags.append({'event_index':index,'code':code,'severity':severity})
  label=normalize_label(e.get('event_label'));e['canonical_label']=label
  if label not in LABELS:flag('unknown_label','error')
  if e.get('event_label')=='Putback':flag('label_alias_normalized','info')
  eventid=e.get('event_id')
  if not eventid or eventid in ids:flag('missing_or_duplicate_event_id','error')
  ids.add(eventid)
  if not str(e.get('player','')).strip() or str(e.get('player')).lower()=='nan':flag('missing_player','error')
  result=e.get('result');caption=str(e.get('caption','')).casefold()
  if not result or str(result).lower()=='nan':flag('missing_result','error')
  if not caption.strip() or caption=='nan':flag('missing_caption','error')
  if result=='made' and re.search(r'\bmiss(?:es|ed)?\b',caption):flag('caption_outcome_conflict','error')
  if result=='missed' and re.search(r'\bmake[sd]?\b',caption):flag('caption_outcome_conflict','error')
  if label in SHOTS and result not in ['made','missed','fouled','outside','timeout']:flag('unusual_action_result')
  if label=='PassBall' and result=='score':flag('pass_result_score_needs_definition')
  stamp=e.get('timestamp_video')
  if not isinstance(stamp,dict):flag('missing_timestamp','error');continue
  start=time_pair(stamp.get('start'));end=time_pair(stamp.get('end'))
  if start is None or end is None:flag('timestamp_format','error');continue
  # Compare raw ordered pairs only; no assumed seconds/frame conversion.
  if start>=end:flag('nonpositive_interval','error')
  if previous and start<previous:flag('start_order_requires_review')
  previous=start
  e['time_base_status']='unresolved_colon_notation';e['start_seconds']=None;e['end_seconds']=None
 return normalized,flags

def run():
 db=ROOT/'data/library/library.db';c=sqlite3.connect(db);c.row_factory=sqlite3.Row
 before=c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]
 out=ROOT/'data/public-sources/pl-nba-audit';out.mkdir(parents=True,exist_ok=True)
 backup=out/'before-audit.db'
 if not backup.exists():
  dest=sqlite3.connect(backup);c.backup(dest);dest.close()
 rawrows=c.execute('SELECT id,group_id,source_member,raw_json FROM external_records ORDER BY id').fetchall()
 normalized=[];content=defaultdict(list);counts=Counter();statuses=Counter();event_counts=Counter()
 for row in rawrows:
  raw=json.loads(row['raw_json']);record,flags=audit(raw)
  if raw.get('video_id')!=row['group_id']:flags.append({'code':'game_group_mismatch','severity':'error'})
  signature=hashlib.sha256(canonical([row['group_id'],raw.get('events')]).encode()).hexdigest();content[signature].append(row['id'])
  normalized.append({'id':row['id'],'group_id':row['group_id'],'source_member':row['source_member'],'record':record,'flags':flags})
 for ids in content.values():
  if len(ids)>1:
   selected=set(ids)
   for item in normalized:
    if item['id'] in selected:item['flags'].append({'code':'identical_annotation_sequence_not_proven_duplicate_video','severity':'warning'})
 c.executescript('''CREATE TABLE IF NOT EXISTS external_quality(
 record_id TEXT PRIMARY KEY REFERENCES external_records(id),audit_version TEXT NOT NULL,
 structural_status TEXT NOT NULL,visual_status TEXT NOT NULL CHECK(visual_status='unverified'),
 canonical_json TEXT NOT NULL,flags_json TEXT NOT NULL,training_ready INTEGER NOT NULL CHECK(training_ready=0));
 CREATE TABLE IF NOT EXISTS external_review_samples(
 id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES external_records(id),event_id TEXT,
 purpose TEXT NOT NULL,media_path TEXT,alignment_status TEXT NOT NULL,details_json TEXT NOT NULL);''')
 with c:
  for item in normalized:
   severity=[f['severity'] for f in item['flags']];status='quarantined_structure' if 'error' in severity else 'needs_consistency_review' if 'warning' in severity else 'structure_checked_only'
   statuses[status]+=1;counts.update(f['code'] for f in item['flags']);event_counts.update(e['canonical_label'] for e in item['record']['events'])
   c.execute('INSERT OR REPLACE INTO external_quality VALUES(?,?,?,?,?,?,?)',(item['id'],'1',status,'unverified',canonical(item['record']),canonical(item['flags']),0))
 samples=[];alignment=[]
 for group,gid in [('20240606_BOS_DAL','0042300401'),('20240612_DAL_BOS','0042300403')]:
  ordered=sorted([x for x in normalized if x['group_id']==group],key=lambda x:int(re.match(r'(\d+)_',Path(x['source_member']).name).group(1)))
  sequence=[]
  for item in ordered:
   for e in item['record']['events']:
    if e['canonical_label'] in SHOTS and e.get('result') in ['made','missed']:sequence.append((item,e,(name(e.get('player')),SHOTS[e['canonical_label']],e['result']=='made')))
  truth=json.loads((ROOT/f'benchmarks/nba/{gid}.json').read_text())['events'];pattern=[(name(e['player']),e['points'],e['made']) for e in truth]
  matches=[i for i in range(len(sequence)-len(pattern)+1) if [x[2] for x in sequence[i:i+len(pattern)]]==pattern]
  alignment.append({'group':group,'matching_sequences':len(matches),'method':'ordered player+points+outcome sequence; hypothesis, not verified full-possession timing'})
  if len(matches)==1:
   for j,(item,event,_) in enumerate(sequence[matches[0]:matches[0]+len(pattern)]):
    local=truth[j]
    samples.append({'id':f'linked-{local["id"]}','record_id':item['id'],'event_id':event['event_id'],'purpose':'verify external shot label against candidate local clip','media_path':local['clip_path'],'alignment_status':'candidate_sequence_match','details':{'external_event':event,'local_event':local,'warning':'Local clip may omit earlier possession actions. Compare only the target shot; do not approve the entire possession.'}})
 # Deterministic coverage: one example per canonical action plus anomalies.
 selected={x['record_id'] for x in samples}
 for label in sorted(LABELS):
  candidate=next((x for x in normalized if x['id'] not in selected and any(e['canonical_label']==label for e in x['record']['events'])),None)
  if candidate:
   selected.add(candidate['id']);samples.append({'id':'coverage-'+label,'record_id':candidate['id'],'event_id':None,'purpose':'action coverage: '+label,'media_path':None,'alignment_status':'no_media','details':{'record':candidate['record'],'flags':candidate['flags'],'warning':'Text consistency review only. Visual approval blocked until matching media exists.'}})
 for code in ['unknown_label','caption_outcome_conflict','nonpositive_interval','pass_result_score_needs_definition','identical_annotation_sequence_not_proven_duplicate_video']:
  item=next((x for x in normalized if x['id'] not in selected and any(f['code']==code for f in x['flags'])),None)
  if item:
   selected.add(item['id']);samples.append({'id':'anomaly-'+code,'record_id':item['id'],'event_id':None,'purpose':'anomaly: '+code,'media_path':None,'alignment_status':'no_media','details':{'record':item['record'],'flags':item['flags']}})
 with c:
  for s in samples:c.execute('INSERT OR REPLACE INTO external_review_samples VALUES(?,?,?,?,?,?,?)',(s['id'],s['record_id'],s['event_id'],s['purpose'],s['media_path'],s['alignment_status'],canonical(s['details'])))
 assert c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]==before
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 summary={'records_checked':len(rawrows),'events_checked':sum(event_counts.values()),'structure_statuses':dict(statuses),'flag_occurrences':dict(counts),'canonical_action_counts':dict(event_counts),'time_base':'unresolved; no seconds conversion approved','representative_samples':len(samples),'samples_with_candidate_local_video':sum(bool(s['media_path']) for s in samples),'visual_accuracy':'not measured','training_ready':0,'alignment_hypotheses':alignment}
 (out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');(out/'samples.json').write_text(json.dumps(samples,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(summary,ensure_ascii=False,indent=2));c.close()
if __name__=='__main__':run()
