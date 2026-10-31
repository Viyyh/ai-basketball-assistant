#!/usr/bin/env python3
"""Local video diagnosis: real inference, all candidates, tentative links, playable report.
No external game answers enter inference. Shots and made/missed remain unverified.
"""
import argparse,json,subprocess,sys,time,html
from pathlib import Path
import cv2
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/pipeline'))
sys.path.insert(0,str(ROOT/'packages/params'))
from basketball_pipeline.ball import BallDetector,BallLinker

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--video',required=True);p.add_argument('--out',required=True)
 p.add_argument('--start',type=float,default=0);p.add_argument('--seconds',type=float,default=30)
 p.add_argument('--fps',type=float,default=8);p.add_argument('--model',default=str(ROOT/'models/ebard-yolov8n.pt'))
 p.add_argument('--tiled',action='store_true');p.add_argument('--imgsz',type=int,default=1280)
 p.add_argument('--conf',type=float,default=.15);p.add_argument('--exclude-bottom',type=float,default=0)
 args=p.parse_args()
 if args.start<0 or args.seconds<=0 or args.fps<=0 or not 0<=args.exclude_bottom<1 or not 0<args.conf<1:p.error('Invalid time, fps, threshold or mask')
 from ultralytics import YOLO
 cap=cv2.VideoCapture(args.video)
 if not cap.isOpened():raise RuntimeError('Cannot open video')
 srcfps=cap.get(cv2.CAP_PROP_FPS)
 if srcfps<=0:raise RuntimeError('Invalid source frame rate')
 rate=min(srcfps,args.fps);out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
 detector=BallDetector(YOLO(args.model),imgsz=args.imgsz,conf=args.conf,tiled=args.tiled,exclude_bottom=args.exclude_bottom)
 linker=BallLinker();frames=[];previous=None;previous_hist=None;last_cut=-10;cuts=[];started=time.perf_counter()
 writer=None
 try:
  for k in range(round(args.seconds*rate)):
   target=round((args.start+k/rate)*srcfps)
   if k==0:cap.set(cv2.CAP_PROP_POS_FRAMES,target);position=target
   while position<target:
    if not cap.grab():break
    position+=1
   ok,frame=cap.read();position+=1
   if not ok:break
   thumb=cv2.resize(frame,(64,36));gray=cv2.cvtColor(thumb,cv2.COLOR_BGR2GRAY)
   difference=float(cv2.absdiff(previous,gray).mean()) if previous is not None else 0
   hsv=cv2.cvtColor(thumb,cv2.COLOR_BGR2HSV)
   histogram=cv2.calcHist([hsv],[0,1],None,[16,16],[0,180,0,256]);cv2.normalize(histogram,histogram)
   histogram_change=cv2.compareHist(previous_hist,histogram,cv2.HISTCMP_BHATTACHARYYA) if previous_hist is not None else 0
   if difference>35 and histogram_change>.65 and k/rate-last_cut>.75:
    linker.reset();cuts.append(k/rate);last_cut=k/rate
   previous=gray;previous_hist=histogram
   boxes=detector.detect(frame);t=args.start+k/rate
   chosen=linker.update(boxes,t,frame.shape[1],frame.shape[0])
   frames.append({'source_seconds':t,'candidates':boxes,'entities':detector.last_entities,'tentative_link':chosen,'cut_score':difference})
   for entity in detector.last_entities:
    a,b,c,d=map(round,entity['xyxy']);color=(255,190,0) if entity['class']=='player' else (200,100,255)
    cv2.rectangle(frame,(a,b),(c,d),color,1);cv2.putText(frame,entity['class'],(a,max(15,b-3)),cv2.FONT_HERSHEY_SIMPLEX,.4,color,1)
   for box in boxes:
    x1,y1,x2,y2=map(round,box['xyxy']);cv2.rectangle(frame,(x1,y1),(x2,y2),(0,165,255),2)
    cv2.putText(frame,f"ball? {box['confidence']:.2f}",(x1,max(18,y1-4)),cv2.FONT_HERSHEY_SIMPLEX,.5,(0,165,255),1)
   if chosen:
    a,b,c,d=chosen['xyxy'];cv2.circle(frame,(round((a+c)/2),round((b+d)/2)),20,(0,255,255),2)
   cv2.putText(frame,f'{t:.2f}s | candidates {len(boxes)} | UNVERIFIED',(20,35),cv2.FONT_HERSHEY_SIMPLEX,.8,(0,255,255),2)
   preview=cv2.resize(frame,(960,540))
   if writer is None:
    writer=cv2.VideoWriter(str(out/'annotated.avi'),cv2.VideoWriter_fourcc(*'MJPG'),rate,(960,540))
    if not writer.isOpened():raise RuntimeError('Cannot create preview')
   writer.write(preview)
   if k%20==0:print(f'{out.name}: {k+1} frames',flush=True)
 finally:
  cap.release()
  if writer:writer.release()
 if not frames:raise RuntimeError('No frames decoded')
 summary={'processed_frames':len(frames),'frames_with_candidates':sum(bool(f['candidates']) for f in frames),'frames_with_multiple_candidates':sum(len(f['candidates'])>1 for f in frames),'tentative_segments':len({f['tentative_link']['segment'] for f in frames if f['tentative_link']}),'possible_cut_seconds':cuts,'elapsed_s':time.perf_counter()-started,'shots':'not implemented','made_missed':'not implemented','warning':'Candidate presence is not detection accuracy. Links and cut flags are unverified. Spectators, replay and camera motion need separate handling.'}
 payload={'settings':vars(args),'summary':summary,'frames':frames}
 (out/'analysis.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(out/'annotated.avi'),'-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'annotated.mp4')],check=True)
 (out/'index.html').write_text('<meta charset="utf-8"><title>本地模型诊断</title><style>body{background:#132032;color:#fff;font:16px sans-serif;max-width:1100px;margin:40px auto}video{width:100%}pre{white-space:pre-wrap}</style><h1>本地真实推理 · '+html.escape(out.name)+'</h1><p>橙框：球候选；黄圈：暂定关联。不是已确认的篮球或投篮结果。</p><video controls src="annotated.mp4"></video><pre>'+html.escape(json.dumps(summary,ensure_ascii=False,indent=2))+'</pre><a href="analysis.json">原始结果</a>')
 print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
