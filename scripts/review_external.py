"""Human review of representative external labels; visual approvals require media."""
import json,secrets,sqlite3,hashlib
from pathlib import Path
from datetime import datetime,timezone
from contextlib import contextmanager
from fastapi import FastAPI,HTTPException,Header
from fastapi.responses import HTMLResponse,FileResponse
from pydantic import BaseModel,Field
from typing import Literal
ROOT=Path(__file__).resolve().parents[1]
class Vote(BaseModel):
 revision:str
 decision:Literal['visually_consistent_target','visually_inconsistent_target','uncertain','text_only_consistent']
 reviewer:str=Field(min_length=1,max_length=80)
 note:str=Field(default='',max_length=3000)
 confirmed:bool=False
 correction:dict=Field(default_factory=dict)
def create_app(db_path=None):
 path=Path(db_path or ROOT/'data/library/library.db');token=secrets.token_hex(24);app=FastAPI(title='外部标注代表样本审核')
 @contextmanager
 def conn():
  c=sqlite3.connect(path);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')
  try:
   with c:yield c
  finally:c.close()
 with conn() as c:c.executescript('''CREATE TABLE IF NOT EXISTS external_sample_reviews(
 id INTEGER PRIMARY KEY,sample_id TEXT NOT NULL REFERENCES external_review_samples(id),
 revision TEXT NOT NULL,decision TEXT NOT NULL,reviewer TEXT NOT NULL,note TEXT NOT NULL,
 correction_json TEXT NOT NULL,created_at TEXT NOT NULL);''')
 def sample(sid):
  with conn() as c:r=c.execute('SELECT s.*,r.raw_sha256 FROM external_review_samples s JOIN external_records r ON r.id=s.record_id WHERE s.id=?',(sid,)).fetchone()
  if not r:raise HTTPException(404,'样本不存在')
  result=dict(r);result['details']=json.loads(result.pop('details_json'));media=result.get('media_path');result['media_available']=bool(media and (ROOT/media).is_file())
  media_hash=None
  if result['media_available']:
   with (ROOT/media).open('rb') as f:media_hash=hashlib.file_digest(f,'sha256').hexdigest()
  result['revision']=hashlib.sha256(json.dumps([result['raw_sha256'],result['details'],media_hash],sort_keys=True,ensure_ascii=False).encode()).hexdigest();return result
 @app.get('/',response_class=HTMLResponse)
 def page():return (ROOT/'tools/external-review.html').read_text().replace('__TOKEN__',token)
 @app.get('/api/samples')
 def samples():
  with conn() as c:
   ids=[r[0] for r in c.execute('SELECT id FROM external_review_samples ORDER BY media_path IS NULL,id')]
   reviews={r['sample_id']:dict(r) for r in c.execute('SELECT * FROM external_sample_reviews WHERE id IN(SELECT MAX(id) FROM external_sample_reviews GROUP BY sample_id)')}
  results=[]
  for sid in ids:
   r=sample(sid);last=reviews.get(sid);r['review']=last if last and last['revision']==r['revision'] else None;results.append(r)
  return results
 @app.get('/api/media/{sid}')
 def media(sid:str):
  item=sample(sid)
  if not item['media_available']:raise HTTPException(404,'没有已匹配视频，不可核验画面')
  p=(ROOT/item['media_path']).resolve()
  if not p.is_relative_to((ROOT/'data').resolve()):raise HTTPException(403)
  return FileResponse(p,media_type='video/mp4')
 @app.post('/api/review/{sid}')
 def review(sid:str,body:Vote,x_review_token:str=Header(default='')):
  if not secrets.compare_digest(token,x_review_token):raise HTTPException(403,'请通过审核页面提交')
  item=sample(sid)
  if item['revision']!=body.revision:raise HTTPException(409,'样本已变化，请刷新')
  if not body.confirmed or not body.reviewer.strip():raise HTTPException(422,'填写审核者并确认已核对')
  if body.decision.startswith('visually_') and not item['media_available']:raise HTTPException(422,'无视频不得提交视觉通过或不通过')
  if body.decision!='visually_consistent_target' and not body.note.strip():raise HTTPException(422,'请说明依据或问题')
  with conn() as c:
   cursor=c.execute('INSERT INTO external_sample_reviews(sample_id,revision,decision,reviewer,note,correction_json,created_at) VALUES(?,?,?,?,?,?,?)',(sid,item['revision'],body.decision,body.reviewer.strip(),body.note,json.dumps(body.correction,ensure_ascii=False),datetime.now(timezone.utc).isoformat()))
   return {'saved':True,'id':cursor.lastrowid,'training_ready':False}
 return app
if __name__=='__main__':
 import uvicorn
 uvicorn.run(create_app(),host='127.0.0.1',port=8012)
