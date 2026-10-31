"""Validate versioned annotations or export only eligible, exhaustively reviewed frames."""
import argparse,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def validate(manifest,records):
 sources={s['id']:s for s in manifest['sources']};ids=set();groups={};counts={}
 for row in records:
  if row['id'] in ids:raise ValueError('duplicate annotation ID')
  ids.add(row['id']);source=sources[row['source_id']]
  if row['group_id']!=source['group_id'] or row['split']!=source['split']:raise ValueError('source split mismatch')
  if row['group_id'] in groups and groups[row['group_id']]!=row['split']:raise ValueError('group leakage')
  groups[row['group_id']]=row['split'];counts[row['status']]=counts.get(row['status'],0)+1
  a=row['annotation']
  if row['kind']=='frame':
   for box in a['objects']:
    if box['class'] not in manifest['classes']:raise ValueError('unknown class')
    x1,y1,x2,y2=box['xyxy']
    if not all(math.isfinite(v) for v in box['xyxy']) or not 0<=x1<x2<=a['width'] or not 0<=y1<y2<=a['height']:raise ValueError('invalid box')
  elif row['kind']=='shot':
   w=a['window'];start=w['start_seconds'];end=w['end_seconds']
   if not math.isfinite(start) or not math.isfinite(end) or not 0<=start<end:raise ValueError('invalid event window')
   if a['outcome'] not in ['made','missed','unknown']:raise ValueError('invalid outcome')
   release=a.get('release_seconds')
   if release is not None and not start<=release<=end:raise ValueError('release outside window')
  else:raise ValueError('unknown annotation kind')
 return counts

def export(manifest,records,out):
 validate(manifest,records);sources={s['id']:s for s in manifest['sources']};eligible=[]
 for row in records:
  if row['kind']=='frame' and row['status']=='reviewed' and row['annotation'].get('exhaustive') and sources[row['source_id']]['training_eligible'] and row['split'] in ['train','val']:
   eligible.append(row)
 if not eligible:raise ValueError('No eligible fully reviewed exhaustive training frames. Approximate, partial and proposal labels cannot train.')
 out=Path(out)
 for row in eligible:
  a=row['annotation'];target=out/row['split'];target.mkdir(parents=True,exist_ok=True)
  lines=[]
  for box in a['objects']:
   x1,y1,x2,y2=box['xyxy'];lines.append(f"{manifest['classes'].index(box['class'])} {(x1+x2)/2/a['width']} {(y1+y2)/2/a['height']} {(x2-x1)/a['width']} {(y2-y1)/a['height']}")
  (target/(row['id']+'.txt')).write_text('\n'.join(lines)+'\n')
 return len(eligible)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--export-labels');args=parser.parse_args()
 manifest=json.loads((ROOT/'datasets/manifest.json').read_text());records=[json.loads(s) for s in (ROOT/manifest['annotation_file']).read_text().splitlines()]
 print(json.dumps(validate(manifest,records),ensure_ascii=False))
 if args.export_labels:print(export(manifest,records,args.export_labels))
