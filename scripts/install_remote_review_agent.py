"""Install the requested login-time supervisor; local configs/logs are not published."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time
from review_gateway import ROOT, DEFAULT_CONFIG, read_config

LABEL='com.victor.basketball-review'

def install(remove=False):
    directory=Path.home()/'Library/LaunchAgents'
    target=directory/(LABEL+'.plist')
    domain='gui/'+str(os.getuid())
    if remove:
        subprocess.run(['launchctl','bootout',domain+'/'+LABEL],capture_output=True)
        if target.exists():target.unlink()
        print('Remote review auto-start removed; local databases retained')
        return
    read_config(DEFAULT_CONFIG)
    directory.mkdir(parents=True,exist_ok=True)
    logs=ROOT/'data/access'
    for name in ['agent.log','agent-error.log']:
        p=logs/name;p.touch(exist_ok=True);p.chmod(0o600)
    config={'Label':LABEL,'ProgramArguments':[sys.executable,str(ROOT/'scripts/remote_review_supervisor.py')],
      'WorkingDirectory':str(ROOT),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
      'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','PYTHONUNBUFFERED':'1'},
      'StandardOutPath':str(logs/'agent.log'),'StandardErrorPath':str(logs/'agent-error.log')}
    target.write_bytes(plistlib.dumps(config));target.chmod(0o600)
    subprocess.run(['launchctl','bootout',domain+'/'+LABEL],capture_output=True)
    # launchd may retain a just-removed label briefly while children shut down.
    for attempt in range(20):
        result=subprocess.run(['launchctl','bootstrap',domain,str(target)],capture_output=True,text=True)
        if result.returncode==0:break
        time.sleep(.4)
    else:
        raise RuntimeError('Could not register login agent: '+result.stderr.strip())
    print(target)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--remove',action='store_true');a=p.parse_args();install(a.remove)
