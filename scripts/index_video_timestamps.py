"""Index original display timestamps without rewriting the video or inventing FPS times."""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

def inspect(path):
    path=Path(path)
    with path.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
    result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time,duration_time','-of','json',str(path)],text=True,capture_output=True,check=True,timeout=300)
    frames=json.loads(result.stdout)['frames']
    times=[]
    for frame in frames:
        value=frame.get('best_effort_timestamp_time')
        times.append(float(value) if value is not None else None)
    missing=sum(t is None or not math.isfinite(t) for t in times)
    differences=[b-a for a,b in zip(times,times[1:]) if a is not None and b is not None]
    return {'filename':path.name,'sha256':sha,'frame_count':len(times),'missing_timestamps':missing,
            'duplicate_adjacent_timestamps':sum(abs(d)<1e-8 for d in differences),
            'backward_adjacent_timestamps':sum(d<0 for d in differences),
            'minimum_positive_delta':min((d for d in differences if d>0),default=None),
            'maximum_delta':max(differences,default=None),'ffprobe_stderr':result.stderr,
            'display_timestamps_seconds':times,
            'note':'Best-effort display timestamps from decoder. This does not certify events or fix frames. Null-muxer DTS warnings are a different measurement.'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('video');p.add_argument('--out',required=True);a=p.parse_args()
    result=inspect(a.video);out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='display_timestamps_seconds'},ensure_ascii=False))
