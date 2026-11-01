"""Password-protected external review service with a separate second-review DB."""
import base64,json,secrets,sqlite3
from pathlib import Path
import uvicorn
from fastapi.responses import Response
from review_materials import create_app,ROOT

def prepare():
 directory=ROOT/'data/library';db=directory/'external-review.db';config=directory/'external-access.local.json'
 if not db.exists():
  original=sqlite3.connect(directory/'library.db');copy=sqlite3.connect(db)
  try:
   original.backup(copy)
   with copy:copy.execute('DELETE FROM human_decisions')
  finally:original.close();copy.close()
 if not config.exists():
  config.write_text(json.dumps({'username':'reviewer','password':secrets.token_urlsafe(18)},indent=2));config.chmod(0o600)
 return db,json.loads(config.read_text())

def external_app(db,credentials):
 app=create_app(db)
 @app.middleware('http')
 async def protect(request,call_next):
  good=False
  try:
   scheme,encoded=request.headers.get('authorization','').split(' ',1)
   username,password=base64.b64decode(encoded,validate=True).decode().split(':',1)
   good=scheme.lower()=='basic' and secrets.compare_digest(username,credentials['username']) and secrets.compare_digest(password,credentials['password'])
  except (ValueError,UnicodeError):pass
  if not good:return Response(status_code=401,headers={'WWW-Authenticate':'Basic realm="Basketball Review", charset="UTF-8"','Cache-Control':'no-store'})
  response=await call_next(request);response.headers['Cache-Control']='no-store';response.headers['X-Robots-Tag']='noindex, nofollow';return response
 return app

def create_shared_app():
 db,credentials=prepare();return external_app(db,credentials)

if __name__=='__main__':
 db,credentials=prepare();uvicorn.run(external_app(db,credentials),host='127.0.0.1',port=8011)
