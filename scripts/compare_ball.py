"""Compare full vs tiled ball inference against small manually located diagnostic set."""
import json,time,sys
from pathlib import Path
import cv2
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/pipeline'))
sys.path.insert(0,str(ROOT/'packages/params'))
from basketball_pipeline.ball import BallDetector,iou
out=ROOT/'data/ball-comparison';out.mkdir(exist_ok=True)
labels=json.loads((ROOT/'benchmarks/nba/ball-labels.json').read_text())['frames']
rows=[]
for weight in ['yolo11n.pt','yolo11m.pt','models/ebard-yolov8n.pt']:
 model=YOLO(str(ROOT/weight))
 for tiled in [False,True]:
  detector=BallDetector(model,tiled=tiled)
  for label in labels:
   frame=cv2.imread(str(ROOT/'data/labels'/f"{label['game']}-{label['seconds']}.jpg"))
   if frame is None:
    source={'game1':'NBA_20240606_DAL+@+BOS_1080p60_ABC.mkv','game3':'NBA_20240612_BOS+@+DAL_1080p60_ABC.mkv'}[label['game']]
    cap=cv2.VideoCapture(str((Path.home()/'Downloads')/source))
    cap.set(cv2.CAP_PROP_POS_MSEC,label['seconds']*1000);ok,frame=cap.read();cap.release()
    if not ok:raise RuntimeError('Cannot decode diagnostic frame')
    (ROOT/'data/labels').mkdir(parents=True,exist_ok=True)
    cv2.imwrite(str(ROOT/'data/labels'/f"{label['game']}-{label['seconds']}.jpg"),frame)
   started=time.perf_counter();boxes=detector.detect(frame);elapsed=time.perf_counter()-started
   overlaps=[iou(label['xyxy'],b['xyxy']) for b in boxes]
   best=max(overlaps,default=0)
   row=dict(label,model=weight,tiled=tiled,elapsed_s=elapsed,best_iou=best,matched_iou_025=best>=.25,candidates=boxes)
   rows.append(row)
   for b in boxes:
    x1,y1,x2,y2=map(round,b['xyxy']);cv2.rectangle(frame,(x1,y1),(x2,y2),(0,165,255),2)
   x1,y1,x2,y2=label['xyxy'];cv2.rectangle(frame,(x1,y1),(x2,y2),(0,255,0),2)
   cv2.imwrite(str(out/f"{label['game']}-{label['seconds']}-{Path(weight).stem}-{'tile' if tiled else 'full'}.jpg"),frame)
   (out/'results.json').write_text(json.dumps(rows,indent=2))
   print(weight,tiled,label['game'],label['seconds'],'IoU',round(best,3),'candidates',len(boxes),flush=True)
