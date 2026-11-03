"""Loopback-only, revision-aware human review workbench."""
import json,hashlib,secrets,sqlite3,subprocess,os,math
from pathlib import Path
from datetime import datetime,timezone
from contextlib import contextmanager
from fastapi import FastAPI,HTTPException,Header
from fastapi.responses import HTMLResponse,FileResponse
from pydantic import BaseModel,Field
from typing import Literal
ROOT=Path(__file__).resolve().parents[1]
TACTIC_LABELS={key for rows in json.loads((ROOT/'datasets/event-taxonomy.json').read_text())['categories'].values() for key,_ in rows}
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
class Decision(BaseModel):
 revision: str
 decision: Literal['approved','rejected','uncertain']
 reviewer: str=Field(min_length=1,max_length=80)
 note: str=Field(default='',max_length=3000)
 confirmed: bool=False
 correction: dict=Field(default_factory=dict)
def create_app(db_path=None):
 db=Path(db_path or ROOT/'data/library/library.db');token=secrets.token_hex(24)
 app=FastAPI(title='素材人工审核')
 @contextmanager
 def conn():
  c=sqlite3.connect(db);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')
  try:
   with c:yield c
  finally:c.close()
 with conn() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS human_decisions(
   id INTEGER PRIMARY KEY,annotation_id TEXT NOT NULL REFERENCES annotations(id),revision TEXT NOT NULL,
   decision TEXT NOT NULL CHECK(decision IN('approved','rejected','uncertain')),reviewer TEXT NOT NULL,
   note TEXT NOT NULL,correction_json TEXT NOT NULL,created_at TEXT NOT NULL,
   snapshot_annotation TEXT NOT NULL,snapshot_review TEXT NOT NULL,snapshot_media TEXT NOT NULL);
   CREATE VIEW IF NOT EXISTS human_clean_annotations AS
    SELECT a.*,d.id AS human_review_id,d.reviewer,d.correction_json,d.revision AS reviewed_revision
    FROM annotations a JOIN human_decisions d ON d.annotation_id=a.id
    WHERE d.id=(SELECT MAX(x.id) FROM human_decisions x WHERE x.annotation_id=a.id)
    AND d.decision='approved' AND a.annotation_json=d.snapshot_annotation
    AND a.review_json=d.snapshot_review AND a.sha256=d.snapshot_media;''')
 def get(record):
  with conn() as c:r=c.execute('SELECT * FROM annotations WHERE id=?',(record,)).fetchone()
  if r is None:raise HTTPException(404,'记录不存在')
  item=dict(r);item['payload']=json.loads(item['annotation_json']);item['revision']=digest([item['sha256'],item['annotation_json'],item['review_json']]);return item
 @app.get('/',response_class=HTMLResponse)
 def page():return (ROOT/'tools/material-review.html').read_text().replace('__TOKEN__',token)
 @app.get('/api/queue')
 def queue():
  with conn() as c:
   rows=c.execute('SELECT id FROM annotations ORDER BY CASE kind WHEN "shot" THEN 0 WHEN "hoop_crop" THEN 1 WHEN "frame" THEN 2 ELSE 3 END,id').fetchall()
   decisions={r['annotation_id']:dict(r) for r in c.execute('SELECT * FROM human_decisions WHERE id IN (SELECT MAX(id) FROM human_decisions GROUP BY annotation_id)')}
  results=[]
  for r in rows:
   item=get(r['id']);previous=decisions.get(r['id']);item['human_review']=previous if previous and previous['revision']==item['revision'] else None
   item['proposal']=None
   with conn() as c:
    exists=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='revision_proposals'").fetchone()
    if exists and previous:
     proposal=c.execute('SELECT * FROM revision_proposals WHERE annotation_id=? AND human_review_id=?',(item['id'],previous['id'])).fetchone()
     if proposal and proposal['annotation_hash']==hashlib.sha256(item['annotation_json'].encode()).hexdigest():item['proposal']=json.loads(proposal['proposed_json'])
   results.append(item)
  return results
 @app.get('/api/media/{record}')
 def media(record:str):
  item=get(record);p=(ROOT/item['media_path']).resolve()
  if not p.is_relative_to((ROOT/'data').resolve()) or not p.is_file():raise HTTPException(404,'媒体不可用')
  return FileResponse(p)
 @app.get('/api/context/{record}')
 def context(record:str):
  item=get(record)
  if item['kind']!='tactic_sample':return media(record)
  payload=item['payload'];window=payload['review_window'];start=float(window['start_seconds']);end=float(window['end_seconds'])
  with conn() as c:source=c.execute('SELECT path FROM sources WHERE id=?',(item['source_id'],)).fetchone()
  if not source or not Path(source['path']).is_file():raise HTTPException(404,'原片不可用')
  cache=ROOT/'data/library/review-clips';cache.mkdir(exist_ok=True);target=cache/(digest([record,item['revision']])+'.mp4')
  if not target.exists():
   temporary=target.with_suffix('.tmp.mp4')
   subprocess.run(['ffmpeg','-v','error','-y','-ss',str(start),'-i',source['path'],'-t',str(end-start),'-vf','scale=960:-2','-c:v','libx264','-preset','ultrafast','-crf','25','-c:a','aac','-movflags','+faststart',str(temporary)],check=True,timeout=90)
   os.replace(temporary,target)
  return FileResponse(target,media_type='video/mp4')
 @app.post('/api/review/{record}')
 def review(record:str,body:Decision,x_review_token:str=Header(default='')):
  if not secrets.compare_digest(x_review_token,token):raise HTTPException(403,'请通过本机审核页面提交')
  if not body.reviewer.strip():raise HTTPException(422,'填写审核者')
  if not body.confirmed:raise HTTPException(422,'请先确认已查看证据')
  item=get(record)
  if item['revision']!=body.revision:raise HTTPException(409,'标注已更新，请刷新后重审')
  if 'shot_type' in body.correction and (item['kind']!='shot' or body.correction['shot_type'] not in ['unknown','layup','floater','jump_shot','dunk','putback','free_throw']):raise HTTPException(422,'无效出手方式')
  if 'object_definition' in body.correction and (item['kind']!='hoop_crop' or body.correction['object_definition']!='hoop_region'):raise HTTPException(422,'当前标注仅支持篮圈加篮网区域')
  if body.decision=='approved' and item['kind']=='tactic_sample':
   label=body.correction.get('tactic');start=body.correction.get('start_seconds');end=body.correction.get('end_seconds');window=item['payload']['review_window']
   if label not in TACTIC_LABELS:raise HTTPException(422,'请选择明确的战术标签；无法判断时请暂缓')
   if type(start) not in [int,float] or type(end) not in [int,float] or not math.isfinite(start) or not math.isfinite(end) or not window['start_seconds']<=start<end<=window['end_seconds']:raise HTTPException(422,'动作起止须在展示的视频区间内')
   if not body.note.strip():raise HTTPException(422,'请描述参与者和动作证据')
  if body.decision!='approved' and not body.note.strip():raise HTTPException(422,'请填写驳回或无法判断的原因')
  with conn() as c:
   result=c.execute('INSERT INTO human_decisions(annotation_id,revision,decision,reviewer,note,correction_json,created_at,snapshot_annotation,snapshot_review,snapshot_media) VALUES(?,?,?,?,?,?,?,?,?,?)',(record,item['revision'],body.decision,body.reviewer.strip(),body.note,json.dumps(body.correction,ensure_ascii=False),datetime.now(timezone.utc).isoformat(),item['annotation_json'],item['review_json'],item['sha256']))
   return {'saved':True,'review_id':result.lastrowid}
 @app.get('/api/export')
 def export():
  with conn() as c:rows=[dict(r) for r in c.execute('SELECT * FROM human_clean_annotations')]
  rows=[r for r in rows if r['reviewed_revision']==get(r['id'])['revision']]
  return {'scope':'human confirmed scoped annotations; not automatically training-ready or exact gold','records':rows}
 return app
if __name__=='__main__':
 import uvicorn
 uvicorn.run(create_app(),host='127.0.0.1',port=8010)
