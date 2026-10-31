"""Small supervised hoop adaptation experiment; never deploy without comparison."""
from pathlib import Path
import json,hashlib
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
 model=YOLO(str(ROOT/'models/ebard-yolov8n.pt'))
 model.train(data=str(ROOT/'data/user-hoop-dataset/data.yaml'),epochs=20,imgsz=640,batch=2,device='cpu',workers=0,freeze=10,optimizer='AdamW',lr0=.001,seed=20261031,deterministic=True,amp=False,cache=False,plots=False,project=str(ROOT/'data/training'),name='hoop-v01',exist_ok=False,patience=6,save=True,verbose=False)
 best=ROOT/'data/training/hoop-v01/weights/best.pt'
 (ROOT/'data/training/hoop-v01/frozen.json').write_text(json.dumps({'checkpoint':str(best.relative_to(ROOT)),'sha256':hashlib.sha256(best.read_bytes()).hexdigest(),'selected_using':'validation only','test_used_for_training':False},indent=2))
