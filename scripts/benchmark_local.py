"""Compare installed weights on reproducible video frames; no automatic accuracy claims."""
import json
import time
from pathlib import Path
import cv2
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/benchmark'
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = {
 'game1': str(Path.home()/'Downloads'/'NBA_20240606_DAL+@+BOS_1080p60_ABC.mkv'),
 'game3': str(Path.home()/'Downloads'/'NBA_20240612_BOS+@+DAL_1080p60_ABC.mkv'),
}
rows=[]
for weight in ['yolo11n.pt', 'yolo11m.pt']:
 model=YOLO(str(ROOT/weight))
 for game,path in SOURCES.items():
  cap=cv2.VideoCapture(path)
  for second in [600,602,604,606,610,615]:
   cap.set(cv2.CAP_PROP_POS_MSEC, second*1000)
   ok,frame=cap.read()
   if not ok: raise RuntimeError(f'Cannot decode {game}:{second}')
   started=time.perf_counter()
   result=model.predict(frame,imgsz=1280,conf=.15,classes=[0,32],device='cpu',verbose=False)[0]
   boxes=[{'class':result.names[int(b.cls.item())],'confidence':round(float(b.conf.item()),3),'xyxy':b.xyxy[0].tolist()} for b in result.boxes]
   row={'model':weight,'game':game,'seconds':second,'elapsed_s':round(time.perf_counter()-started,3),'persons':sum(b['class']=='person' for b in boxes),'balls':sum(b['class']=='sports ball' for b in boxes),'boxes':boxes}
   rows.append(row)
   cv2.imwrite(str(OUT/f'{game}-{second}-{Path(weight).stem}.jpg'),result.plot())
   (OUT/'detections.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
   print({k:v for k,v in row.items() if k!='boxes'},flush=True)
  cap.release()
