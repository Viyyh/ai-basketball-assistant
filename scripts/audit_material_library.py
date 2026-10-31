"""Register original media integrity and scoped visual-review decisions.
Does not claim to watch entire videos or grant a second human review.
"""
import json,hashlib,subprocess
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
 return h.hexdigest()
def build():
 snapshot=ROOT/'datasets/library/review-inputs-v0.1.json'
 if snapshot.exists():
  for name,expected in json.loads(snapshot.read_text()).items():
   if digest(ROOT/name)!=expected:raise ValueError('Annotation changed; renewed visual review required: '+name)
 out=ROOT/'data/library';out.mkdir(exist_ok=True)
 users=json.loads((ROOT/'data/user-materials/inventory.json').read_text())
 sources=[{'id':r['id'],'path':r['path'],'group_id':'fiba-asian-cup-2025' if r['id'] in ['user-video-04','user-video-05'] else r['id']} for r in users]
 sources += [{'id':'0042300401','path':str(Path.home()/'Downloads/NBA_20240606_DAL+@+BOS_1080p60_ABC.mkv'),'group_id':'nba-finals-2024'},{'id':'0042300403','path':str(Path.home()/'Downloads/NBA_20240612_BOS+@+DAL_1080p60_ABC.mkv'),'group_id':'nba-finals-2024'},{'id':'amateur-baseline-compilation-01','path':json.loads((ROOT/'data/tactics/inventory.json').read_text())['path'],'group_id':'baseline-compilation-all-excerpts'}]
 catalog=[]
 for source in sources:
  path=Path(source['path']);print('Checking',path.name,flush=True)
  if not path.is_file():
   catalog.append(dict(source,filename=path.name,admission='quarantined_missing_original',sha256=None,visual_review_scope='retained derivatives only; original unavailable',human_signoff=False));continue
  probe=json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,width,height,r_frame_rate','-of','json',str(path)],capture_output=True,text=True,check=True).stdout)
  catalog.append(dict(source,filename=path.name,bytes=path.stat().st_size,sha256=digest(path),probe=probe,admission='registered_original',visual_review_scope='sampled frames/windows only; full video not reviewed',human_signoff=False))
 (out/'sources.local.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
 rows=[]
 for line in (ROOT/'datasets/user-videos/hoop-v0.1.jsonl').read_text().splitlines():
  r=json.loads(line);hard=r['source_id']=='user-video-03'
  rows.append({'id':r['id'],'source_id':r['source_id'],'kind':'hoop_crop','admission':('restricted_reference' if hard else 'accepted_scoped') if any(c['id']==r['source_id'] and c.get('sha256') for c in catalog) else 'restricted_missing_original','media_path':r['media_path'],'sha256':digest(ROOT/r['media_path']),'original_annotation_file':'datasets/user-videos/hoop-v0.1.jsonl','scope':'single-class rim+net crop, approximate visible box; not full-frame labels','reviewer':'assistant_visual_review','human_signoff':False,'original_available':any(c['id']==r['source_id'] and c.get('sha256') for c in catalog),'notes':'rear view; support/backboard occludes rim, do not use as clean hoop gold label' if hard else ('no hoop visible in this crop; negative only for hoop class' if not r['objects'] else 'rim/net confirmed in crop; approximate boundaries, single reviewer'),'test_status':'previously_evaluated_not_blind' if hard else 'development'})
 for line in (ROOT/'datasets/annotations/v0.1.jsonl').read_text().splitlines():
  r=json.loads(line)
  rows.append({'id':r['id'],'source_id':r['source_id'],'kind':r['kind'],'admission':'accepted_scoped','media_path':r['media_path'],'sha256':digest(ROOT/r['media_path']),'original_annotation_file':'datasets/annotations/v0.1.jsonl','scope':'official outcome with coarse video window; no exact release frame' if r['kind']=='shot' else 'approximate ball box, non-exhaustive diagnostic frame only','reviewer':'assistant_visual_review','human_signoff':False,'notes':'storyboard checked, official-record result retained; exact timing not certified' if r['kind']=='shot' else 'visible ball confirmed; not exhaustive training labels','test_status':'development'})
 for line in (ROOT/'datasets/tactics/review-queue-v0.1.jsonl').read_text().splitlines():
  r=json.loads(line)
  rows.append({'id':r['id'],'source_id':r['source_id'],'kind':'tactic_sample','admission':'quarantined_pending','media_path':r['media_path'],'sha256':digest(ROOT/r['media_path']),'original_annotation_file':'datasets/tactics/review-queue-v0.1.jsonl','scope':'scene illustration only; no confirmed temporal tactic label','reviewer':'assistant_visual_review','human_signoff':False,'notes':'title/arrows do not prove action class; needs continuous temporal review','test_status':'development'})
 for row in rows:
  row['training_ready']=False;row['exact_gold_label']=False
 ids=[r['id'] for r in rows];assert len(ids)==len(set(ids))
 (ROOT/'datasets/library/records-v0.1.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
 machine=[]
 for path in (ROOT/'data/final').glob('*-basketball/event-candidates.json'):
  for event in json.loads(path.read_text())['events']:machine.append({'source_file':str(path.relative_to(ROOT)),'id':event['id'],'admission':'quarantined_model_candidate'})
 summary={'version':'0.1','registered_source_entries':len(catalog),'available_original_sources':sum(c['sha256'] is not None for c in catalog),'missing_original_sources':sum(c['sha256'] is None for c in catalog),'available_original_duration_hours':sum(float(c['probe']['format']['duration']) for c in catalog if 'probe' in c)/3600,'unique_file_hashes':len({c['sha256'] for c in catalog if c['sha256']}),'annotation_records':len(rows),'decisions':dict(Counter(r['admission'] for r in rows)),'machine_candidates_excluded':len(machine),'full_video_visual_review_completed':False,'independent_human_signoff':False,'automated_checks':['original SHA-256','ffprobe headers','annotation file existence/hash','unique annotation IDs'],'review_scope':'19 hoop crops, 3 ball diagnostic frames, 9 event storyboards, 12 tactic stills; approximate/single reviewer only'}
 (ROOT/'datasets/library/summary-v0.1.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');(out/'machine-quarantine.json').write_text(json.dumps(machine,indent=2))
 return catalog,rows,summary
if __name__=='__main__':
 c,r,s=build();print(json.dumps(s,ensure_ascii=False,indent=2))
