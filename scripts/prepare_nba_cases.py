"""Export manually located event windows, preserving alignment uncertainty."""
import json
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CASES={
 '0042300401':('NBA_20240606_DAL+@+BOS_1080p60_ABC.mkv',[(601,606),(620,625),(635,640),(644,650),(658,664)]),
 '0042300403':('NBA_20240612_BOS+@+DAL_1080p60_ABC.mkv',[(598,604),(610,615),(621,627),(636,642)])}
out=ROOT/'data/validation';out.mkdir(parents=True,exist_ok=True)
for game,(name,windows) in CASES.items():
 path=ROOT/'benchmarks/nba'/f'{game}.json';truth=json.loads(path.read_text())
 for event,(start,end) in zip(truth['events'],windows,strict=True):
  event['video_window']={'start_seconds':start,'end_seconds':end,'status':'manually checked coarse event window','precision':'not frame-accurate; includes action and outcome'}
  event['clip_path']='data/validation/'+event['id'].replace(':','-')+'.mp4'
  subprocess.run(['ffmpeg','-v','error','-y','-ss',str(start),'-i',str((Path.home()/'Downloads')/name),'-t',str(end-start),'-an','-vf','scale=960:-2','-c:v','libx264','-preset','ultrafast','-crf','23','-movflags','+faststart',str(ROOT/event['clip_path'])],check=True)
  print(event['id'],start,end,flush=True)
 path.write_text(json.dumps(truth,ensure_ascii=False,indent=2)+'\n')
