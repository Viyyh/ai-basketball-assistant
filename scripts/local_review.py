"""Loopback-only review launcher. Never launches a tunnel or edits remote settings."""
import argparse
from contextlib import asynccontextmanager
import html
import os
from pathlib import Path
import socket
import subprocess
import sys
from urllib.parse import urlencode
import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from player_workbench import ROOT


def second_app():
    from share_review import prepare
    from review_materials import create_app
    db,_=prepare()
    return create_app(db)


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=.5):return True
    except OSError:return False


def create_app(open_browser=False):
    children=[];logs=[]
    @asynccontextmanager
    async def lifespan(app):
        env=os.environ.copy();env['PYTHONPATH']=str(ROOT/'scripts')
        directory=ROOT/'data/local-review';directory.mkdir(parents=True,exist_ok=True)
        try:
            for port,factory in [(8010,'review_materials:create_app'),(8012,'review_external:create_app'),(8013,'player_workbench:create_app'),(8016,'local_review:second_app'),(8017,'review_acquired:create_app')]:
                if listening(port):continue
                path=directory/(str(port)+'.log');f=path.open('a');logs.append(f)
                children.append(subprocess.Popen([sys.executable,'-m','uvicorn',factory,'--factory','--host','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT))
            if open_browser:subprocess.Popen(['open','http://127.0.0.1:8015/'])
            yield
        finally:
            for child in children:
                if child.poll() is None:child.terminate()
            for child in children:
                try:child.wait(timeout=8)
                except subprocess.TimeoutExpired:child.kill()
            for f in logs:f.close()
    app=FastAPI(title='本地审核入口',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    @app.get('/health')
    def health():return {'service':'basketball-local-review'}
    @app.get('/',response_class=HTMLResponse)
    def page():
        from review_manifest import build
        s=build();p=s['player'];second=s['second'];ext=s['external']
        cards=[(8017,'新采集片段审核','外部实际取得的窗口；多标签、参与者、区间与不确定原因'),(8013,'个人视频复盘',f"身份待确认{p.get('players_pending',0)}人，动作待处理{p.get('event_pending',0)}条"),(8016,'历史素材独立二审',f"{second['pending']}条尚未提交二审决定，不自动覆盖主库"),(8010,'主素材库审核','本地直接审核主库，已有决定与历史保留'),(8012,'外部来源核查',f"{ext.get('representatives',0)}个代表样本，{ext.get('missing_media',0)}个缺视频")]
        content=''.join(f'<article><h2>{title}</h2><p>{html.escape(note)}</p><a href="http://127.0.0.1:{port}/">进入审核</a></article>' for port,title,note in cards)
        tasks=''.join('<li><a href="http://127.0.0.1:8013/?'+html.escape(urlencode({k:t[k] for k in ['source_id','start','end']}),quote=True)+'">'+html.escape(f"{t['name']} {t['start']:.2f}-{t['end']:.2f}秒")+'</a></li>' for t in p.get('continuous_tasks',[]))
        return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地审核入口</title><style>body{font:17px/1.7 system-ui;background:#f2f6f2;color:#163d43;max-width:1100px;margin:35px auto;padding:20px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}article{background:white;padding:24px;border:1px solid #cfdfda;border-radius:14px}a{color:#087f80}</style><h1>本地审核入口</h1><p>仅当前电脑可访问，无需登录。此操作没有开启公网分享。若页面刚启动尚未加载，稍等后刷新。</p><section>'+content+'</section><h2>连续原片待复核分段</h2><ol>'+tasks+'</ol><p>看完整段、补齐遗漏事件后登记复核范围。关闭启动终端或按Ctrl+C可结束本次新启动的本地服务。</p></html>'
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--no-browser',action='store_true');args=parser.parse_args()
    if listening(8015):
        r=httpx.get('http://127.0.0.1:8015/health',timeout=3,trust_env=False)
        if r.status_code!=200 or r.json().get('service')!='basketball-local-review':raise SystemExit('8015端口被其他服务占用')
        print('本地审核已经开启：http://127.0.0.1:8015/')
        if not args.no_browser:subprocess.Popen(['open','http://127.0.0.1:8015/'])
    else:
        import uvicorn
        print('本地审核：http://127.0.0.1:8015/；关闭窗口或Ctrl+C结束。',flush=True)
        uvicorn.run(create_app(not args.no_browser),host='127.0.0.1',port=8015)
