"""Keep the authenticated gateway, private backends and temporary tunnel running."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from review_gateway import ROOT, DEFAULT_CONFIG, private_write, read_config, update_config

ACCESS=ROOT/'data/access'


def main():
    ACCESS.mkdir(parents=True,exist_ok=True)
    lock=(ACCESS/'supervisor.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('Remote review supervisor is already running')
    lock.write(str(os.getpid()));lock.flush()
    update_config(DEFAULT_CONFIG,lambda cfg:cfg.update(allowed_hosts=['127.0.0.1','localhost'],public_origin=None))
    env=os.environ.copy();env['PYTHONPATH']=str(ROOT/'scripts')
    apps=[('materials','review_materials:create_app',18010),('second','share_review:create_shared_app',18011),('external','review_external:create_app',18012),('player','player_workbench:create_app',18013)]
    commands={name:[sys.executable,'-m','uvicorn',factory,'--factory','--host','127.0.0.1','--port',str(port),'--no-access-log'] for name,factory,port in apps}
    commands['gateway']=[sys.executable,str(ROOT/'scripts/review_gateway.py')]
    commands['tunnel']=[str(ROOT/'data/tools/cloudflared'),'tunnel','--url','http://127.0.0.1:8014','--protocol','http2','--no-autoupdate']
    children={};logs={};last_start={};running=True;known_url=None
    def stop(*args):
        nonlocal running
        running=False
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    def spawn(name):
        nonlocal known_url
        if name in logs:logs[name].close()
        path=ACCESS/(name+'.log');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        logs[name]=os.fdopen(fd,'w');children[name]=subprocess.Popen(commands[name],cwd=ROOT,env=env,stdout=logs[name],stderr=subprocess.STDOUT)
        last_start[name]=time.monotonic()
        if name=='tunnel':
            known_url=None
            update_config(DEFAULT_CONFIG,lambda cfg:cfg.update(allowed_hosts=['127.0.0.1','localhost'],public_origin=None))
            private_write(ACCESS/'public-address.local.json',{'url':None,'status':'starting'})
    try:
        for name in commands:spawn(name)
        while running:
            for name,child in list(children.items()):
                if child.poll() is not None and time.monotonic()-last_start[name]>8:spawn(name)
            text=(ACCESS/'tunnel.log').read_text(errors='replace')
            urls=re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',text)
            if urls and urls[-1]!=known_url:
                known_url=urls[-1];host=known_url.removeprefix('https://')
                update_config(DEFAULT_CONFIG,lambda cfg:cfg.update(allowed_hosts=['127.0.0.1','localhost',host],public_origin=known_url))
                private_write(ACCESS/'public-address.local.json',{'url':known_url,'status':'tunnel_requested','note':'Temporary URL changes after tunnel restart. Authentication required for all resources.'})
            time.sleep(2)
    finally:
        for child in children.values():
            if child.poll() is None:child.terminate()
        for child in children.values():
            try:child.wait(timeout=8)
            except subprocess.TimeoutExpired:child.kill()
        for log in logs.values():log.close()
        private_write(ACCESS/'public-address.local.json',{'url':known_url,'status':'stopped'})

if __name__=='__main__':main()
