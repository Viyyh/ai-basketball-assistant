"""Fail-closed, immutable YOLO snapshot export. Never exports test or unapproved records."""
import argparse,json,hashlib,shutil,tempfile,os
from pathlib import Path
from dataset import validate
ROOT=Path(__file__).resolve().parents[1]
def export_snapshot(manifest,records,destination,root=ROOT):
 validate(manifest,records);root=Path(root).resolve();destination=Path(destination)
 if destination.exists():raise ValueError('Destination exists; choose a new version')
 sources={s['id']:s for s in manifest['sources']}
 eligible=[r for r in records if r['kind']=='frame' and r['split'] in ['train','val'] and r['status']=='reviewed' and r['annotation'].get('exhaustive') is True and sources[r['source_id']].get('training_eligible') is True]
 if {r['split'] for r in eligible}!={'train','val'}:raise ValueError('Need approved, exhaustive frames in both train and val; no test fallback')
 verified=[];hash_splits={}
 from PIL import Image
 for r in eligible:
  media=(root/r['media_path']).resolve()
  if not media.is_relative_to(root):raise ValueError('Media path escapes dataset root')
  actual=hashlib.sha256(media.read_bytes()).hexdigest()
  if r.get('media_sha256')!=actual:raise ValueError('Missing or changed reviewed image hash: '+r['id'])
  if actual in hash_splits:raise ValueError('Duplicate media content; deduplicate before export')
  hash_splits[actual]=r['split']
  with Image.open(media) as image:image.verify()
  with Image.open(media) as image:
   if image.getexif().get(274,1)!=1:raise ValueError('Normalize image orientation and review coordinates before export')
   if image.size!=(r['annotation']['width'],r['annotation']['height']):raise ValueError('Image dimensions mismatch')
  verified.append((r,media,actual))
 destination.parent.mkdir(parents=True,exist_ok=True);temporary=Path(tempfile.mkdtemp(prefix='.dataset-export-',dir=destination.parent))
 try:
  provenance=[]
  for row,media,sha in verified:
   split=row['split'];images=temporary/split/'images';labels=temporary/split/'labels';images.mkdir(parents=True,exist_ok=True);labels.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(media,images/(row['id']+media.suffix.lower()))
   a=row['annotation'];lines=[]
   for box in a['objects']:
    x,y,xx,yy=box['xyxy'];lines.append(f"{manifest['classes'].index(box['class'])} {(x+xx)/2/a['width']} {(y+yy)/2/a['height']} {(xx-x)/a['width']} {(yy-y)/a['height']}")
   (labels/(row['id']+'.txt')).write_text('\n'.join(lines)+('\n' if lines else ''))
   provenance.append({'id':row['id'],'source_id':row['source_id'],'group_id':row['group_id'],'split':split,'media_sha256':sha})
  (temporary/'data.yaml').write_text('path: '+json.dumps(str(destination.resolve()))+'\ntrain: train/images\nval: val/images\nnames: '+json.dumps(manifest['classes'])+'\n')
  (temporary/'provenance.json').write_text(json.dumps({'manifest':manifest,'exported':provenance},ensure_ascii=False,indent=2)+'\n')
  os.rename(temporary,destination)
 except BaseException:
  shutil.rmtree(temporary);raise
 return {'train':sum(r['split']=='train' for r,_,_ in verified),'val':sum(r['split']=='val' for r,_,_ in verified),'test':0}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',default=str(ROOT/'datasets/manifest.json'));p.add_argument('--out',required=True);args=p.parse_args()
 manifest=json.loads(Path(args.manifest).read_text());records=[json.loads(x) for x in (ROOT/manifest['annotation_file']).read_text().splitlines()]
 try:print(export_snapshot(manifest,records,args.out))
 except (ValueError,OSError) as e:p.exit(2,str(e)+'\n')
