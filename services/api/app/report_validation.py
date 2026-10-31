"""Use the single JS contract validator at the API write boundary."""
import json,os,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
class InvalidReport(ValueError):pass
class ValidatorUnavailable(RuntimeError):pass
def find_node():
 configured=os.environ.get('BASKETBALL_NODE')
 if configured:return configured
 found=shutil.which('node')
 if found:return found
 local=ROOT/'data/tools/node/bin/node'
 return str(local) if local.is_file() else None
def validate_report(report):
 try:payload=json.dumps(report,allow_nan=False,ensure_ascii=False)
 except (ValueError,TypeError) as e:raise InvalidReport('报告含不可序列化或非有限数字') from e
 if len(payload.encode())>2*1024*1024:raise InvalidReport('报告超过 2MB 限制')
 node=find_node()
 if not node:raise ValidatorUnavailable('报告校验需要 Node ≥20；请安装 Node 或设置 BASKETBALL_NODE')
 try:
  result=subprocess.run([node,str(ROOT/'contracts/bin/validate-report.mjs'),'-'],input=payload,text=True,capture_output=True,timeout=10)
 except (OSError,subprocess.TimeoutExpired) as e:raise ValidatorUnavailable('报告校验器不可用') from e
 if result.returncode==1:raise InvalidReport((result.stdout or result.stderr)[:4000])
 if result.returncode!=0:raise ValidatorUnavailable('报告校验器执行失败')
