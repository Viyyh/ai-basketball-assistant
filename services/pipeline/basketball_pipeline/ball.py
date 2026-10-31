"""Ball candidates from full-frame + tiled inference. No event/identity claims."""
from __future__ import annotations
import math

def iou(a, b):
    left=max(a[0],b[0]); top=max(a[1],b[1])
    right=min(a[2],b[2]); bottom=min(a[3],b[3])
    intersection=max(0,right-left)*max(0,bottom-top)
    union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection
    return intersection/union if union>0 else 0

def merge_candidates(candidates, threshold=.35):
    result=[]
    for candidate in sorted(candidates,key=lambda b:b['confidence'],reverse=True):
        if not any(iou(candidate['xyxy'],b['xyxy'])>threshold for b in result):
            result.append(candidate)
    return result

class BallDetector:
    def __init__(self, model, *, imgsz=1280, conf=.15, tiled=True, device='cpu', exclude_bottom=0):
        self.model=model;self.imgsz=imgsz;self.conf=conf;self.tiled=tiled
        self.device=device;self.exclude_bottom=exclude_bottom
        names=getattr(model,'names',{})
        self.scene_classes=[int(i) for i,name in names.items() if str(name).lower() in ('hoop','player','referee')]
        self.last_entities=[]
        self.ball_classes=[int(i) for i,name in names.items() if str(name).lower().replace('_',' ') in ('sports ball','basketball','ball')]
        if not self.ball_classes:raise ValueError(f'Model has no ball class: {names}')

    def detect(self, frame):
        height,width=frame.shape[:2]
        regions=[(0,0,width,height)]
        if self.tiled:
            # Overlap prevents balls at crop boundaries being systematically lost.
            tw=round(width*.6); th=round(height*.6)
            regions += [(x,y,x+tw,y+th) for y in [0,height-th] for x in [0,width-tw]]
        candidates=[]
        self.last_entities=[]
        for x1,y1,x2,y2 in regions:
            prediction=self.model.predict(frame[y1:y2,x1:x2],imgsz=self.imgsz,conf=self.conf,
                                          classes=self.ball_classes+self.scene_classes,device=self.device,verbose=False)[0]
            for box in prediction.boxes:
                a,b,c,d=map(float,box.xyxy[0].tolist())
                xyxy=[a+x1,b+y1,c+x1,d+y1]
                cls=int(box.cls.item())
                if cls in self.scene_classes:
                    if (x1,y1,x2,y2)==regions[0]:
                        self.last_entities.append({'class':str(self.model.names[cls]),'xyxy':xyxy,'confidence':float(box.conf.item())})
                    continue
                if (xyxy[1]+xyxy[3])/2 >= height*(1-self.exclude_bottom):continue
                candidates.append({'xyxy':xyxy,'confidence':float(box.conf.item()),'source':'full' if (x1,y1,x2,y2)==regions[0] else 'tile'})
        return merge_candidates(candidates)

class BallLinker:
    """Conservative short links; missing frames stay missing, never hallucinated."""
    def __init__(self,max_gap=.35,max_speed=1.5):
        self.max_gap=max_gap;self.max_speed=max_speed;self.previous=None;self.segment=0
    def reset(self):
        self.previous=None;self.segment+=1
    def update(self,candidates,t,width,height):
        if not candidates:return None
        previous=self.previous
        def center(box):return ((box[0]+box[2])/2,(box[1]+box[3])/2)
        eligible=[]
        if previous and 0<t-previous['time']<=self.max_gap:
            px,py=center(previous['xyxy']);dt=t-previous['time']
            for candidate in candidates:
                x,y=center(candidate['xyxy']);distance=math.hypot(x-px,y-py)/math.hypot(width,height)
                if distance<=self.max_speed*dt:
                    eligible.append((distance,candidate))
        if eligible:
            chosen=min(eligible,key=lambda item:item[0])[1]
        else:
            self.segment+=1;chosen=max(candidates,key=lambda b:b['confidence'])
        self.previous=dict(chosen,time=t,segment=self.segment)
        return self.previous
