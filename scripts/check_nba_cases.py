"""Measure ball candidate availability in aligned clips, not event accuracy."""
import json
from pathlib import Path
import cv2
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parents[1]
model=YOLO(str(ROOT/'yolo11m.pt'))
rows=[]
for truth_path in sorted((ROOT/'benchmarks/nba').glob('*.json')):
 truth=json.loads(truth_path.read_text())
 for event in truth['events']:
  cap=cv2.VideoCapture(str(ROOT/event['clip_path']));fps=cap.get(cv2.CAP_PROP_FPS)
  index=0;sampled=0;ball_frames=0;multiple=0
  while True:
   ok,frame=cap.read()
   if not ok:break
   if index%max(1,round(fps/5))==0:
    result=model.predict(frame,imgsz=1280,conf=.15,classes=[32],device='cpu',verbose=False)[0]
    n=len(result.boxes);sampled+=1;ball_frames+=n>0;multiple+=n>1
   index+=1
  cap.release()
  row={'event_id':event['id'],'sampled_frames':sampled,'frames_with_ball_candidates':ball_frames,'frames_with_multiple_candidates':multiple,'candidate_coverage':ball_frames/sampled if sampled else None}
  rows.append(row);print(row,flush=True)
  (ROOT/'data/validation/ball-availability.json').write_text(json.dumps(rows,indent=2))
