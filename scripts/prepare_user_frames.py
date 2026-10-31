import json,cv2
from pathlib import Path
from PIL import Image,ImageDraw
out=Path(__file__).resolve().parents[1]/'data/user-materials';rows=json.loads((out/'inventory.json').read_text())
for row in rows:
 cap=cv2.VideoCapture(row['path']);sheet=Image.new('RGB',(1920,760),'white');draw=ImageDraw.Draw(sheet)
 for i,t in enumerate([30,60,120,180,240,300]):
  cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,f=cap.read()
  if not ok:continue
  cv2.imwrite(str(out/f"{row['id']}-{t}.jpg"),f)
  x=i%3*640;y=i//3*380;sheet.paste(Image.fromarray(cv2.cvtColor(f,cv2.COLOR_BGR2RGB)).resize((640,360)),(x,y));draw.text((x+5,y+362),str(t),fill='black')
 sheet.save(out/f"{row['id']}-sheet.jpg");cap.release()
