"""Manually open/close remote review. No login-time persistence is installed."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import sys
import time
from review_gateway import ROOT, DEFAULT_CONFIG, read_config, private_write

LABEL='com.victor.basketball-review'
ACCESS=ROOT/'data/access'

def launch(*args):
    return subprocess.run(['launchctl',*args],capture_output=True,text=True)

def running():
    return launch('print','gui/'+str(os.getuid())+'/'+LABEL).returncode==0

def status():
    active=running()
    info={}
    try:info=json.loads((ACCESS/'public-address.local.json').read_text())
    except (OSError,ValueError):pass
    return {'running':active,'url':info.get('url') if active and info.get('status')!='stopped' else None}

def disable_login_start():
    # Retire only this project's earlier opt-in login item, not any other agents.
    p=Path.home()/'Library/LaunchAgents'/(LABEL+'.plist')
    if p.exists():p.unlink()

def stop():
    disable_login_start()
    result=launch('bootout','gui/'+str(os.getuid())+'/'+LABEL)
    if result.returncode and running():
        raise RuntimeError('无法停止服务：'+result.stderr.strip())
    # The supervisor terminates only its own backends/tunnel and preserves databases.
    for _ in range(100):
        try:
            with socket.create_connection(('127.0.0.1',8014),timeout=.2):pass
        except OSError:
            print('远程审核已关闭；视频、账号和数据库已保留。本地审核入口不受影响。')
            return
        time.sleep(.2)
    raise RuntimeError('已发出关闭请求，但8014端口仍在使用，请检查data/access日志')

def start():
    disable_login_start()
    if running():
        print('远程审核已在运行，不会重复启动或更换当前网址。')
        show_status()
        return
    read_config(DEFAULT_CONFIG)
    ACCESS.mkdir(parents=True,exist_ok=True)
    for name in ['agent.log','agent-error.log']:
        f=ACCESS/name;f.touch(exist_ok=True);f.chmod(0o600)
    path=ACCESS/'on-demand-agent.plist'
    spec={'Label':LABEL,'ProgramArguments':[sys.executable,str(ROOT/'scripts/remote_review_supervisor.py')],
          'WorkingDirectory':str(ROOT),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
          'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','PYTHONUNBUFFERED':'1'},
          'StandardOutPath':str(ACCESS/'agent.log'),'StandardErrorPath':str(ACCESS/'agent-error.log')}
    path.write_bytes(plistlib.dumps(spec));path.chmod(0o600)
    private_write(ACCESS/'public-address.local.json',{'url':None,'status':'starting'})
    for _ in range(20):
        result=launch('bootstrap','gui/'+str(os.getuid()),str(path))
        if result.returncode==0:break
        time.sleep(.4)
    else:raise RuntimeError('启动失败：'+result.stderr.strip())
    print('正在开启受保护的远程审核，请稍候……',flush=True)
    for _ in range(45):
        s=status()
        if s['url']:
            print('本次分享网址：'+s['url'])
            print('账号密码保持不变。用完请执行“关闭远程审核”。')
            return
        time.sleep(1)
    print('服务已启动，临时网址仍在申请。稍后执行status查看。')

def show_status():
    s=status()
    print('远程访问：'+('开启' if s['running'] else '关闭'))
    if s['url']:print('当前网址：'+s['url'])
    print('此模式不会在下次登录电脑时自动开启。')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['start','stop','status'])
    a=parser.parse_args()
    try:{'start':start,'stop':stop,'status':show_status}[a.action]()
    except (OSError,ValueError,RuntimeError) as e:raise SystemExit(str(e))
