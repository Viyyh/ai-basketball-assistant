import json,cv2,hashlib
from pathlib import Path
r=Path(__file__).resolve().parents[1];out=r/'data/user-hoop-dataset';rows=[]
def add(video,t,split,box,crop):
 src=r/f'data/user-materials/{video}-{t}.jpg';im=cv2.imread(str(src));x,y,xx,yy=crop;im=im[y:yy,x:xx];h,w=im.shape[:2];name=f'{video}-{t}';objects=[]
 if box:
  a,b,c,d=box;objects=[{'class':'hoop','xyxy':[a-x,b-y,c-x,d-y]}]
 for folder in ['images','labels']:(out/split/folder).mkdir(parents=True,exist_ok=True)
 dest=out/split/'images'/f'{name}.jpg';cv2.imwrite(str(dest),im)
 label=''
 for o in objects:
  a,b,c,d=o['xyxy'];assert 0<=a<c<=w and 0<=b<d<=h
  label+=f'0 {(a+c)/2/w} {(b+d)/2/h} {(c-a)/w} {(d-b)/h}\n'
 (out/split/'labels'/f'{name}.txt').write_text(label)
 group='fiba-asian-cup-2025' if video in ['user-video-04','user-video-05'] else video
 rows.append({'id':name,'source_id':video,'group_id':group,'seconds':t,'split':split,'status':'reviewed','review_method':'assistant visual inspection; approximate hand-drawn boxes, single reviewer','scope':'hoop rim+net within manually chosen crop, not ball or shot labels','crop_xyxy':crop,'width':w,'height':h,'objects':objects,'media_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'media_path':str(dest.relative_to(r))})
for t in [30,60,120,180,240,300]:add('user-video-01',t,'train',[922,214,974,283],[700,80,1150,400])
add('user-video-04',300,'train',[545,346,605,405],[400,200,800,500])
add('user-video-05',240,'train',[590,346,657,410],[400,200,800,500])
add('user-video-04',30,'train',None,[700,500,1200,950])
add('user-video-05',120,'train',None,[700,500,1200,950])
for t,box,crop in [(180,[857,182,985,310],[650,80,1100,400]),(240,[813,273,870,337],[650,150,1100,450]),(300,[956,295,1014,365],[800,200,1200,450])]:add('user-video-02',t,'val',box,crop)
for t in [30,60,120,180,240,300]:add('user-video-03',t,'test',[860,355,1018,512],[650,200,1200,520])
(r/'datasets/user-videos/hoop-v0.1.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))
(out/'data.yaml').write_text(f'path: {out}\ntrain: train/images\nval: val/images\ntest: test/images\nnames:\n  0: hoop\n')
print(len(rows),'reviewed crops')
