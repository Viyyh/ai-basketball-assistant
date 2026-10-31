import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'packages/params'),str(ROOT/'services/pipeline')]
from basketball_pipeline.events import rim_crossing_candidates
p=argparse.ArgumentParser();p.add_argument('analysis');p.add_argument('--out',required=True);a=p.parse_args()
d=json.loads(Path(a.analysis).read_text());events=rim_crossing_candidates(d['frames'])
Path(a.out).write_text(json.dumps({'schema_version':'event-candidates-1','source_analysis':a.analysis,'events':events,'warning':'Experimental candidates only; absence does not imply no shot. Outcomes remain unknown.'},indent=2)+'\n');print(len(events),'candidates')
