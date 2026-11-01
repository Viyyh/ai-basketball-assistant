"""One-to-one shot-event evaluation on explicitly exhaustive reviewed windows.
Input timestamps are verified ball-release seconds, never window midpoints.
"""
import argparse
import json
import math
from pathlib import Path


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def evaluate(prediction, reference, tolerance=0.5):
    if not finite(tolerance) or tolerance < 0:
        raise ValueError('tolerance must be finite and nonnegative')
    if not isinstance(prediction.get('events'),list) or not isinstance(reference.get('events'),list):
        raise ValueError('Both inputs must explicitly include an events array, even for negative windows')
    windows = reference.get('reviewed_windows', [])
    if reference.get('exhaustive') is not True or not windows:
        raise ValueError('Need exhaustive reviewed windows, including negative windows')
    for w in windows:
        if not isinstance(w.get('source_id'),str) or not w['source_id'] or not all(finite(w.get(k)) for k in ('start','end')) or not 0 <= w['start'] < w['end']:
            raise ValueError('Invalid reviewed window')
    def inside(e):
        return any(w['source_id']==e['source_id'] and w['start']<=e['time_s']<w['end'] for w in windows)
    def checked(rows):
        ids=set()
        for e in rows:
            if not isinstance(e.get('id'),str) or not e['id'] or e['id'] in ids:
                raise ValueError('Missing or duplicate event ID')
            ids.add(e['id'])
            if not isinstance(e.get('source_id'),str) or not finite(e.get('time_s')) or e['time_s']<0:
                raise ValueError('Need finite release time_s and source ID; window midpoint is not a release label')
            if e.get('outcome','unknown') not in ('made','missed','unknown'):
                raise ValueError('Invalid outcome')
            if e.get('player_id') is not None and not isinstance(e['player_id'],str):
                raise ValueError('Invalid player ID')
        return sorted(rows,key=lambda e:(e['source_id'],e['time_s'],e['id']))
    truth=checked(reference.get('events',[]))
    predictions=checked(prediction.get('events',[]))
    if any(not inside(e) for e in truth):
        raise ValueError('Reference event outside declared reviewed windows')
    scoped=[e for e in predictions if inside(e)]
    # Maximum cardinality bipartite matching; labels never influence the assignment.
    edges={i:sorted([j for j,g in enumerate(truth) if g['source_id']==p['source_id'] and abs(g['time_s']-p['time_s'])<=tolerance],key=lambda j:(abs(truth[j]['time_s']-p['time_s']),truth[j]['id'])) for i,p in enumerate(scoped)}
    assigned={}
    reverse={}
    for root in range(len(scoped)):
        queue=[root];seen_predictions={root};parent={};terminal=None
        for i in queue:
            for j in edges[i]:
                if j in parent:continue
                parent[j]=i
                if j not in assigned:
                    terminal=j
                    break
                other=assigned[j]
                if other not in seen_predictions:
                    seen_predictions.add(other);queue.append(other)
            if terminal is not None:break
        while terminal is not None:
            i=parent[terminal]
            previous=reverse.get(i)
            assigned[terminal]=i;reverse[i]=terminal
            terminal=previous
    pairs=[(scoped[i],truth[j]) for j,i in sorted(assigned.items())]
    tp=len(pairs);fp=len(scoped)-tp;fn=len(truth)-tp
    known=[(p,g) for p,g in pairs if g.get('outcome','unknown')!='unknown']
    answered=[(p,g) for p,g in known if p.get('outcome','unknown')!='unknown']
    correct=sum(p.get('outcome')==g.get('outcome') for p,g in known)
    identified=[(p,g) for p,g in pairs if g.get('player_id')]
    identity_correct=sum(p.get('player_id')==g['player_id'] for p,g in identified)
    return {'tolerance_seconds':tolerance,'matching':'maximum-cardinality temporal matching; independent of identity/outcome labels',
            'reference_events':len(truth),'scoped_predictions':len(scoped),'excluded_unreviewed_predictions':len(predictions)-len(scoped),
            'true_positive':tp,'false_positive':fp,'false_negative':fn,
            'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,
            'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,
            'known_reference_results':len(known),'result_abstentions':len(known)-len(answered),
            'result_accuracy_including_abstentions':correct/len(known) if known else None,
            'result_accuracy_when_answered':correct/len(answered) if answered else None,
            'identity_reference_count':len(identified),'identity_correct':identity_correct,
            'identity_accuracy_on_matched_events':identity_correct/len(identified) if identified else None,
            'ambiguous_prediction_count':sum(len(v)>1 for v in edges.values()),
            'matches':[{'prediction_id':p['id'],'reference_id':g['id'],'absolute_time_error':abs(p['time_s']-g['time_s'])} for p,g in pairs],
            'warning':'Results apply only to declared exhaustive windows. Matched-event result/identity accuracy excludes missed shots; do not call this overall video accuracy. This tool does not certify annotation independence or blind-test status.'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--predictions',required=True);p.add_argument('--reference',required=True)
    p.add_argument('--tolerance',type=float,default=.5);p.add_argument('--out',required=True)
    args=p.parse_args()
    result=evaluate(json.loads(Path(args.predictions).read_text()),json.loads(Path(args.reference).read_text()),args.tolerance)
    Path(args.out).write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(args.out)
