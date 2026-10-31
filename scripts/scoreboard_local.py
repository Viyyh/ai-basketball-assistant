"""Mac-only local scoreboard OCR. Detects score changes, not shot attempts.
No official answers are loaded. Uses source-specific ESPN scoreboard crop.
"""
import argparse,json,re,subprocess
from pathlib import Path
import cv2
ROOT=Path(__file__).resolve().parents[1]
SOURCES={'game1':'NBA_20240606_DAL+@+BOS_1080p60_ABC.mkv','game3':'NBA_20240612_BOS+@+DAL_1080p60_ABC.mkv'}
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--prepare',action='store_true');p.add_argument('--ocr-binary',default='/tmp/basketball-ocr');args=p.parse_args()
out=ROOT/'data/scoreboard';out.mkdir(parents=True,exist_ok=True)
if args.prepare:
 for game,name in SOURCES.items():
  cap=cv2.VideoCapture(str(Path.home()/'Downloads'/name))
  for second in range(598,671 if game=='game1' else 646):
   cap.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,frame=cap.read()
   if not ok:raise RuntimeError('decode failed')
   h,w=frame.shape[:2]
   cv2.imwrite(str(out/f'{game}-{second}.jpg'),frame[round(h*.875):round(h*.945),round(w*.235):round(w*.78)])
  cap.release()
else:
 for game in SOURCES:
  images=sorted(out.glob(game+'-*.jpg'))
  raw=subprocess.run([args.ocr_binary,*map(str,images)],check=True,capture_output=True,text=True)
  (out/f'{game}-raw.jsonl').write_text(raw.stdout)
  readings=[]
  for line in raw.stdout.splitlines():
   item=json.loads(line);text=' '.join(item['text']);teams={}
   for team in ['BOS','DAL']:
    match=re.search(r'\b'+team+r'\s+(\d{1,3})\b',text)
    if match:teams[team]=int(match.group(1))
   clock=re.search(r'\b([0-9]{1,2}:[0-5][0-9])\b',text)
   period=re.search(r'\b([1-4])(?:ST|ND|RD|TH)\b',text)
   if len(teams)==2 and clock and period:
    readings.append({'video_seconds':int(Path(item['path']).stem.split('-')[-1]),'clock':clock.group(1),'period':int(period.group(1)),'score':teams})
  changes=[];previous=None
  for i,reading in enumerate(readings[:-1]):
   # Require repeated same score in consecutive source seconds.
   nxt=readings[i+1]
   if nxt['video_seconds']!=reading['video_seconds']+1 or nxt['score']!=reading['score']:continue
   if previous is None:previous=reading;continue
   delta={t:reading['score'][t]-previous['score'][t] for t in ['BOS','DAL']}
   changed=[t for t,v in delta.items() if v]
   if not changed:previous=reading;continue
   if len(changed)==1 and delta[changed[0]] in [1,2,3]:
    team=changed[0];changes.append({'video_seconds':reading['video_seconds'],'period':reading['period'],'clock':reading['clock'],'team':team,'score_delta':delta[team],'score':reading['score'],'status':'scoreboard change, not shot release'})
    previous=reading
  result={'game':game,'readable_frames':len(readings),'total_frames':len(images),'readings':readings,'score_changes':changes,'limitations':'ESPN-specific crop, scoreboard updates lag play; cannot detect misses, disambiguate free throws, or identify shooter. Needs generalisation for hand-shot footage.'}
  (out/f'{game}.json').write_text(json.dumps(result,indent=2));print(game,len(readings),changes,flush=True)
