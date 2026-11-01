"""Authenticated loopback gateway for basketball review apps; no database serving."""
import argparse
import fcntl
import tempfile
import base64
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import html
import json
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

ROOT=Path(__file__).resolve().parents[1]
DEFAULT_CONFIG=ROOT/'data/access/gateway.local.json'
BACKENDS={'player':'http://127.0.0.1:18013','materials':'http://127.0.0.1:18010',
          'second':'http://127.0.0.1:18011','external':'http://127.0.0.1:18012'}
LABELS={'player':'个人视频复盘','materials':'主素材库审核','second':'独立二审','external':'外部来源核验'}
ITERATIONS=600_000

def password_hash(password,salt=None):
    salt=salt or secrets.token_hex(16)
    result=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),ITERATIONS).hex()
    return {'salt':salt,'hash':result}

def read_config(path):
    c=json.loads(Path(path).read_text())
    if not c.get('users') or not c.get('allowed_hosts'):
        raise ValueError('Access whitelist is missing')
    return c

def private_write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.'+path.name,dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:
            json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        os.replace(temporary,path)
        path.chmod(0o600)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)

def update_config(path,mutate):
    path=Path(path)
    fd=os.open(str(path)+'.lock',os.O_RDWR|os.O_CREAT,0o600)
    with os.fdopen(fd,'r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        config=read_config(path);mutate(config);private_write(path,config)
        return config

def setup(path=DEFAULT_CONFIG):
    path=Path(path)
    if path.exists():return path
    admin=secrets.token_urlsafe(20);reviewer=secrets.token_urlsafe(20)
    users={
      'owner':password_hash(admin)|{'enabled':True,'role':'admin','apps':{k:'review' for k in BACKENDS}},
      'reviewer':password_hash(reviewer)|{'enabled':True,'role':'reviewer','apps':{'player':'review','second':'review','external':'view'}}}
    private_write(path,{'users':users,'allowed_hosts':['127.0.0.1','localhost'],'public_origin':None})
    private_write(path.parent/'credentials.local.json',{'owner':admin,'reviewer':reviewer,
      'note':'owner为管理员；reviewer可以个人复盘纠错与独立二审。不要分享owner。可用user命令创建独立账号。'})
    return path

def permitted(app,path,method,role):
    if method not in ('GET','HEAD','POST','DELETE'):return False
    if path=='/':return method in ('GET','HEAD')
    if path=='/api/export':return role=='admin' and method in ('GET','HEAD')
    key=r'[A-Za-z0-9_][A-Za-z0-9_.:-]*'
    if app=='player':
        if path=='/api/state':return method in ('GET','HEAD')
        if re.fullmatch('/api/media/'+key,path):return method in ('GET','HEAD')
        if re.fullmatch('/api/(players|events)/'+key,path):return method=='POST'
        if path=='/api/coverage':return method=='POST'
        if re.fullmatch('/api/coverage/'+key,path):return method=='DELETE'
    elif app in ('materials','second'):
        if path=='/api/queue' or re.fullmatch('/api/(media|context)/'+key,path):return method in ('GET','HEAD')
        if re.fullmatch('/api/review/'+key,path):return method=='POST'
    elif app=='external':
        if path=='/api/samples' or re.fullmatch('/api/media/'+key,path):return method in ('GET','HEAD')
        if re.fullmatch('/api/review/'+key,path):return method=='POST'
    return False

def create_app(config_path=DEFAULT_CONFIG,transport=None):
    config_path=Path(config_path);read_config(config_path)
    client=httpx.AsyncClient(transport=transport,timeout=httpx.Timeout(100,connect=5),trust_env=False)
    @asynccontextmanager
    async def lifespan(app):
        yield
        await client.aclose()
    app=FastAPI(title='篮球审核安全入口',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    failures=defaultdict(deque);cache={}

    def audit(user,request,status):
        # Never record Authorization, body, query, media content or credentials.
        record={'time':datetime.now(timezone.utc).isoformat(),'user':user,
                'ip':request.headers.get('cf-connecting-ip',request.client.host if request.client else 'unknown'),
                'method':request.method,'path':request.url.path,'status':status}
        log=config_path.parent/'access.jsonl'
        if log.exists() and log.stat().st_size>10*1024*1024:
            os.replace(log,config_path.parent/'access.previous.jsonl')
        fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
        with os.fdopen(fd,'a') as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')

    @app.middleware('http')
    async def protection(request,call_next):
        username='anonymous'
        def finish(response):
            response.headers.update({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',
              'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
              'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
            audit(username,request,response.status_code)
            return response
        try:c=read_config(config_path)
        except (OSError,ValueError):return finish(Response('入口配置不可用',status_code=503))
        if request.url.hostname not in c['allowed_hosts']:
            return finish(Response('访问主机不在白名单',status_code=400))
        if request.url.scheme!='https' and request.url.hostname not in ['127.0.0.1','localhost','testserver']:
            return finish(Response('请使用HTTPS地址访问',status_code=426))
        ip=request.headers.get('cf-connecting-ip',request.client.host if request.client else 'unknown')
        now=time.monotonic()
        if len(failures)>4096:
            for key in list(failures):
                if not failures[key] or failures[key][-1]<now-600:failures.pop(key,None)
        attempts=failures[ip]
        while attempts and attempts[0]<now-600:attempts.popleft()
        if len(attempts)>=8:return finish(Response('尝试过多，请10分钟后重试',status_code=429,headers={'Retry-After':'600'}))
        supplied=None
        try:
            scheme,encoded=request.headers.get('authorization','').split(' ',1)
            if len(encoded)>1024:raise ValueError()
            if scheme.lower()!='basic':raise ValueError()
            username,password=base64.b64decode(encoded,validate=True).decode().split(':',1)
            if not re.fullmatch('[A-Za-z0-9_-]{1,40}',username):raise ValueError()
            user=c['users'].get(username)
            if user and user.get('enabled'):
                key=hashlib.sha256((encoded+user['hash']).encode()).hexdigest()
                if cache.get(key,0)>now or hmac.compare_digest(password_hash(password,user['salt'])['hash'],user['hash']):
                    supplied=user
                    if len(cache)>512:cache.clear()
                    cache[key]=now+120
        except (ValueError,UnicodeError,KeyError):pass
        if supplied is None:
            if request.headers.get('authorization'):attempts.append(now)
            return finish(Response('需要白名单账号登录',status_code=401,headers={'WWW-Authenticate':'Basic realm="Basketball Review", charset="UTF-8"'}))
        request.state.user=username;request.state.access=supplied;request.state.config=c
        if request.method not in ('GET','HEAD'):
            origin=request.headers.get('origin')
            expected=c.get('public_origin')
            local_origin=request.url.scheme+'://'+request.headers['host']
            if not origin or origin not in [expected,local_origin]:
                return finish(Response('请求来源不匹配',status_code=403))
        return finish(await call_next(request))

    @app.get('/',response_class=HTMLResponse)
    def portal(request:Request):
        u=request.state.access
        cards=''.join(f'<article><h2>{html.escape(LABELS[k])}</h2><p>{"可审核与纠错" if grant=="review" else "仅查看"}</p><a href="/{k}/">进入</a></article>' for k,grant in u['apps'].items() if k in BACKENDS)
        role='管理员' if u['role']=='admin' else '审核账号'
        return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>篮球审核入口</title><style>body{{background:#f2f6f2;color:#163b43;font:17px/1.7 system-ui;max-width:1000px;margin:50px auto;padding:20px}}section{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}}article{{background:white;border:1px solid #cedfda;padding:24px;border-radius:15px}}a{{background:#087f80;color:white;padding:8px 20px;border-radius:8px;text-decoration:none}}</style><h1>篮球视频复盘与人工审核</h1><p>当前账号：{html.escape(request.state.user)} · {role}</p><section>{cards}</section><p>每次提交会使用你的登录账号署名。审核不自动批准训练；原片和数据库不对匿名访客开放。</p><p>数据库文件与账户管理不通过此网址提供。切换账号请使用新的隐私浏览窗口；退出时关闭该窗口。</p></html>'''

    @app.api_route('/{app_key}/{path:path}',methods=['GET','HEAD','POST','DELETE','PUT','PATCH','OPTIONS'])
    async def proxy(app_key:str,path:str,request:Request):
        access=request.state.access;grant=access['apps'].get(app_key);target='/'+path
        if app_key not in BACKENDS or not grant:return Response('没有此系统的权限',status_code=403)
        if not permitted(app_key,target,request.method,access['role']):return Response('入口未开放此功能',status_code=403)
        if request.method not in ('GET','HEAD') and grant!='review':return Response('此账号只有查看权限',status_code=403)
        headers={k:v for k,v in request.headers.items() if k.lower() in ['range','if-range','content-type','x-review-token']}
        if app_key=='second':
            try:legacy=json.loads((ROOT/'data/library/external-access.local.json').read_text())
            except (OSError,ValueError):return Response('独立二审不可用',status_code=503)
            headers['authorization']='Basic '+base64.b64encode((legacy['username']+':'+legacy['password']).encode()).decode()
        params=dict(request.query_params)
        if 'reviewer' in params:params['reviewer']=request.state.user
        body=b''
        if request.method not in ('GET','HEAD'):
            chunks=[];total=0
            async for chunk in request.stream():
                total+=len(chunk)
                if total>65536:return Response('提交内容过大',status_code=413)
                chunks.append(chunk)
            body=b''.join(chunks)
            if body:
                try:
                    payload=json.loads(body,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('nonfinite')))
                    if not isinstance(payload,dict):raise ValueError()
                    payload['reviewer']=request.state.user
                    body=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
                except (ValueError,UnicodeError):return Response('提交格式无效',status_code=422)
        try:
            upstream=await client.send(client.build_request(request.method,BACKENDS[app_key]+target,params=params,headers=headers,content=body),stream=True)
        except httpx.HTTPError:return Response('本机审核服务暂不可用',status_code=503)
        response_headers={k:v for k,v in upstream.headers.items() if k.lower() in ['content-type','content-range','accept-ranges','etag','last-modified','content-length','content-disposition']}
        if target=='/' and 'text/html' in upstream.headers.get('content-type',''):
            content=(await upstream.aread()).decode();await upstream.aclose()
            content=content.replace("'/api/",f"'/{app_key}/api/").replace('"/api/',f'"/{app_key}/api/')
            user=json.dumps(request.state.user).replace('<','\\u003c')
            style=''
            if access['role']!='admin':style+='#export,a[href$="/api/export"]{display:none!important}'
            if grant!='review':style+='[data-decision],[data-vote],#save,#coverageSave,#new,#players button,#coverageList button{display:none!important}'
            banner=f'<div style="padding:12px;background:#e6f3ec"><a href="/">返回入口</a> · {html.escape(request.state.user)} · {"可审核" if grant=="review" else "只读"}</div>'
            content=content.replace('<body>','<body>'+banner,1) if '<body>' in content else content.replace('</style>','</style>'+banner,1)
            content+=f'<style>{style}</style><script>const gatewayReviewer=document.getElementById("reviewer");if(gatewayReviewer){{gatewayReviewer.value={user};gatewayReviewer.readOnly=true;}}</script>'
            return HTMLResponse(content,status_code=upstream.status_code)
        if upstream.is_stream_consumed:
            return Response(upstream.content,status_code=upstream.status_code,headers=response_headers,background=BackgroundTask(upstream.aclose))
        return StreamingResponse(upstream.aiter_raw(),status_code=upstream.status_code,headers=response_headers,background=BackgroundTask(upstream.aclose))
    return app

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',default=str(DEFAULT_CONFIG));p.add_argument('--port',type=int,default=8014)
    p.add_argument('--setup',action='store_true');p.add_argument('--user');p.add_argument('--role',choices=['admin','reviewer','viewer']);p.add_argument('--disable',action='store_true')
    a=p.parse_args()
    if a.setup:print(setup(a.config))
    elif a.user:
        if not re.fullmatch('[A-Za-z0-9_-]{1,40}',a.user):raise SystemExit('Use a safe account name')
        c=read_config(a.config)
        if a.disable:
            update_config(a.config,lambda c:c['users'][a.user].update(enabled=False));print('Account disabled')
        else:
            password=secrets.token_urlsafe(20);role=a.role or 'reviewer'
            apps={k:'review' for k in BACKENDS} if role=='admin' else {'player':'review' if role=='reviewer' else 'view','second':'review' if role=='reviewer' else 'view','external':'view'}
            account=password_hash(password)|{'role':role,'enabled':True,'apps':apps}
            update_config(a.config,lambda c:c['users'].update({a.user:account}))
            dest=Path(a.config).parent/'credentials.local.json'
            creds=json.loads(dest.read_text()) if dest.exists() else {};creds[a.user]=password;private_write(dest,creds);print('Account saved; password in local credentials file')
    else:
        import uvicorn
        uvicorn.run(create_app(a.config),host='127.0.0.1',port=a.port,proxy_headers=True,forwarded_allow_ips='127.0.0.1',access_log=False)
