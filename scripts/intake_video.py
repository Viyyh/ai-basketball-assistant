"""Create a local-only intake manifest for a new video; does not approve training."""
import argparse,json,hashlib,subprocess,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def inspect(path,source_id,group_id):
 path=Path(path).resolve()
 if not re.fullmatch(r'[A-Za-z0-9_-]+',source_id) or not group_id.strip():raise ValueError('Use a safe source ID and nonempty session/court group ID')
 if not path.is_file():raise ValueError('Video does not exist')
 result=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,width,height,r_frame_rate','-of','json',str(path)],capture_output=True,text=True,check=True,timeout=60)
 metadata=json.loads(result.stdout)
 videos=[s for s in metadata['streams'] if s.get('codec_type')=='video']
 if not videos or float(metadata['format']['duration'])<=0:raise ValueError('No valid video stream/duration')
 with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
 return {'id':source_id,'group_id':group_id,'path':str(path),'filename':path.name,'sha256':digest,'bytes':path.stat().st_size,'metadata':metadata,'status':'intake_unreviewed','training_ready':False,'split':'unassigned','note':'Keep related session/court footage grouped; do not assign an already-used source as a new blind test.'}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('video');p.add_argument('--source-id',required=True);p.add_argument('--group-id',required=True);a=p.parse_args()
 record=inspect(a.video,a.source_id,a.group_id);out=ROOT/'data/library/intake';out.mkdir(parents=True,exist_ok=True);target=out/(a.source_id+'.json')
 if target.exists() and json.loads(target.read_text())['sha256']!=record['sha256']:raise SystemExit('Source ID already belongs to different content')
 target.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(target)
