"""Review actual acquired external clips, isolated from human gold and training."""
import hashlib,json,secrets,sqlite3
from pathlib import Path
from fastapi import FastAPI,Header,HTTPException
from fastapi.responses import HTMLResponse,FileResponse
from pydantic import BaseModel,ConfigDict,Field
from typing import Literal
ROOT=Path(__file__).resolve().parents[1]
class Vote(BaseModel):
 model_config=ConfigDict(allow_inf_nan=False,extra='forbid')
 revision:str
 reviewer:str=Field(min_length=1,max_length=80)
 viewed:Literal[True]
 decision:Literal['confirmed','uncertain','rejected']
 tags:list[str]=Field(default_factory=list,max_length=12)
 start:float=Field(ge=0,strict=True)
 end:float=Field(gt=0,strict=True)
 participants:str=Field(default='',max_length=500)
 note:str=Field(default='',max_length=2000)
def create_app(db_path=None,manifest_path=None):
 db=Path(db_path or ROOT/'data/library/acquired-review.db');db.parent.mkdir(parents=True,exist_ok=True)
 manifest=Path(manifest_path or ROOT/'data/public-sources/playon-pilot/manifest.json')
 token=secrets.token_hex(24);app=FastAPI(title='外部新素材待审核')
 taxonomy=json.loads((ROOT/'datasets/event-taxonomy.json').read_text())['categories'];allowed={k for rows in taxonomy.values() for k,_ in rows}
 def connect():
  c=sqlite3.connect(db);c.row_factory=sqlite3.Row;return c
 with connect() as c:
  c.executescript('CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY,clip_id TEXT NOT NULL,base TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);')
 if manifest.exists():
  with connect() as c:
   for row in json.loads(manifest.read_text())['records']:
    if 'sha256' in row:c.execute('INSERT INTO clips VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',(row['id'],json.dumps(row,ensure_ascii=False,sort_keys=True)))
 def get(key):
  with connect() as c:
   row=c.execute('SELECT payload FROM clips WHERE id=?',(key,)).fetchone()
   last=c.execute('SELECT * FROM decisions WHERE clip_id=? ORDER BY id DESC LIMIT 1',(key,)).fetchone()
  if not row:raise HTTPException(404)
  r=json.loads(row['payload']);path=(ROOT/r['path']).resolve()
  if not path.is_relative_to((ROOT/'data').resolve()) or not path.is_file():raise HTTPException(409,'媒体缺失')
  actual=hashlib.sha256(path.read_bytes()).hexdigest()
  if actual!=r['sha256']:raise HTTPException(409,'文件已变更，请重新接收')
  base=hashlib.sha256(row['payload'].encode()).hexdigest()
  r['review']=json.loads(last['payload']) if last and last['base']==base else None
  r['revision']=hashlib.sha256((base+str(last['id'] if last else 0)).encode()).hexdigest();r['base']=base
  return r,path
 @app.get('/',response_class=HTMLResponse)
 def page():return (ROOT/'tools/acquired-review.html').read_text().replace('__TOKEN__',token).replace('__TAXONOMY__',json.dumps(taxonomy,ensure_ascii=False))
 @app.get('/api/queue')
 def queue():
  with connect() as c:ids=[r[0] for r in c.execute('SELECT id FROM clips ORDER BY id')]
  return [get(key)[0] for key in ids]
 @app.get('/api/media/{key}')
 def media(key:str):return FileResponse(get(key)[1],media_type='video/mp4')
 @app.post('/api/review/{key}')
 def vote(key:str,body:Vote,x_review_token:str=Header(default='')):
  if not secrets.compare_digest(token,x_review_token):raise HTTPException(403)
  if not body.reviewer.strip():raise HTTPException(422,'填写审核者')
  if not set(body.tags)<=allowed or len(set(body.tags))!=len(body.tags):raise HTTPException(422,'标签无效或重复')
  if not body.note.strip():raise HTTPException(422,'请记录证据或不确定原因')
  with connect() as c:
   c.execute('BEGIN IMMEDIATE');r,_=get(key)
   if body.revision!=r['revision']:raise HTTPException(409,'其他审核者已更新，请刷新')
   if not body.start<body.end<=r['duration']:raise HTTPException(422,'起止超出片段')
   if body.decision=='confirmed' and (not body.tags or not body.participants.strip()):raise HTTPException(422,'确认时须选标签并说明参与者')
   c.execute('INSERT INTO decisions(clip_id,base,payload) VALUES(?,?,?)',(key,r['base'],json.dumps(body.model_dump(),ensure_ascii=False)))
  return {'saved':True,'training_ready':False,'scope':'只确认所填区间的标签，不自动批准训练或全片'}
 return app
if __name__=='__main__':
 import uvicorn
 uvicorn.run(create_app(),host='127.0.0.1',port=8017)
