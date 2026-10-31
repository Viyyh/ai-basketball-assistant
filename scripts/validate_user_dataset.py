import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def validate(rows):
 groups={};ids=set()
 for row in rows:
  assert row['id'] not in ids,'duplicate';ids.add(row['id'])
  group=row['group_id'];split=row['split'];assert split in ['train','val','test']
  assert groups.get(group,split)==split,'group leakage';groups[group]=split
  path=ROOT/row['media_path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==row['media_sha256'],'image changed'
  for box in row['objects']:
   x,y,xx,yy=box['xyxy'];assert 0<=x<xx<=row['width'] and 0<=y<yy<=row['height'],'out of bounds'
 return {s:sum(r['split']==s for r in rows) for s in ['train','val','test']}
if __name__=='__main__':
 print(validate([json.loads(x) for x in (ROOT/'datasets/user-videos/hoop-v0.1.jsonl').read_text().splitlines()]))
