"""One frozen-checkpoint comparison; no checkpoint selection on test."""
import json,sys,hashlib
from pathlib import Path
import cv2
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'packages/params'),str(ROOT/'services/pipeline')]
from basketball_pipeline.ball import iou
if __name__=='__main__':
 freeze=ROOT/'data/training/hoop-v01/frozen.json';meta=json.loads(freeze.read_text());best=ROOT/meta['checkpoint']
 assert hashlib.sha256(best.read_bytes()).hexdigest()==meta['sha256']
 out=ROOT/'data/user-materials/evaluation';out.mkdir(exist_ok=True)
 result_file=out/'results.json'
 if result_file.exists():raise SystemExit('Test already evaluated; keep the saved result. Do not silently rescore as a new blind test.')
 rows=[json.loads(x) for x in (ROOT/'datasets/user-videos/hoop-v0.1.jsonl').read_text().splitlines()]
 results=[]
 for name,weights in [('baseline',ROOT/'models/ebard-yolov8n.pt'),('adapted',best)]:
  model=YOLO(str(weights));classes=[i for i,n in model.names.items() if n=='hoop']
  for row in rows:
   if row['split'] not in ['val','test']:continue
   frame=cv2.imread(str(ROOT/row['media_path']));pred=model.predict(frame,imgsz=640,conf=.25,classes=classes,device='cpu',verbose=False)[0]
   boxes=[b.xyxy[0].tolist() for b in pred.boxes];truth=[o['xyxy'] for o in row['objects']]
   best_iou=max((iou(a,b) for a in truth for b in boxes),default=0)
   results.append({'model':name,'id':row['id'],'split':row['split'],'best_iou':best_iou,'matched_iou_050':best_iou>=.5,'predicted_boxes':boxes,'ground_truth':truth})
   preview=pred.plot()
   for a,b,c,d in truth:cv2.rectangle(preview,(a,b),(c,d),(0,255,0),2)
   cv2.imwrite(str(out/f'{name}-{row["id"]}.jpg'),preview)
 result_file.write_text(json.dumps({'frozen':meta,'config':{'imgsz':640,'confidence':.25,'match_iou':.5},'rows':results,'scope':'Small human-cropped hoop region benchmark, not full-frame or shot accuracy. Test source is one indoor camera, six correlated frames.'},indent=2))
 for model in ['baseline','adapted']:
  for split in ['val','test']:
   selected=[r for r in results if r['model']==model and r['split']==split];print(model,split,sum(r['matched_iou_050'] for r in selected),'/',len(selected))
