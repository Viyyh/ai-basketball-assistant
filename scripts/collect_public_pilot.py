"""Bounded author-published basketball sample acquisition; never training approval."""
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE='https://github.com/playon/basketball-analysis-samples'
STREAM='https://d1l0eyz2lfj4xa.cloudfront.net/playOnPoly/693d86be47fd95f56c93ef98/cloud_hls/0_hd_hls.m3u8'
def collect():
 out=ROOT/'data/public-sources/playon-pilot';out.mkdir(parents=True,exist_ok=True)
 def one(start):
  target=out/f'window-{start}.mp4'
  record={'id':f'playon-{start}','source_url':SOURCE,'stream_url':STREAM,'group_id':'playon-single-game','source_start':start,'requested_seconds':15,'training_ready':False,'usage':'author provides sample download for proof-of-concept; training/redistribution not cleared','selection':'uniform separated windows, not verified tactical clips','status':'candidate'}
  try:
   if not target.exists():subprocess.run(['ffmpeg','-v','error','-rw_timeout','15000000','-ss',str(start),'-i',STREAM,'-t','15','-vf','scale=960:-2','-c:v','libx264','-preset','ultrafast','-crf','24','-an',str(target)],check=True,timeout=90,capture_output=True)
   metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(target)]))
   record.update(path=str(target.relative_to(ROOT)),sha256=hashlib.sha256(target.read_bytes()).hexdigest(),bytes=target.stat().st_size,duration=float(metadata['format']['duration']))
  except (subprocess.SubprocessError,OSError,ValueError) as e:record.update(status='acquisition_failed',error=type(e).__name__)
  return record
 with ThreadPoolExecutor(max_workers=2) as pool:records=list(pool.map(one,range(600,4800,150)))
 if (out/'manifest.json').exists():
  previous={r['id']:r for r in json.loads((out/'manifest.json').read_text())['records']}
  for r in records:
   for key in ['assistant_hint','priority']:
    if key in previous.get(r['id'],{}):r[key]=previous[r['id']][key]
 (out/'manifest.json').write_text(json.dumps({'source':SOURCE,'records':records,'note':'All from one game; never split these windows across train and blind test.'},ensure_ascii=False,indent=2)+'\n')
 print('Acquired',sum('sha256' in r for r in records),'of',len(records),'windows')
if __name__=='__main__':collect()
