"""Evaluate event proposals in game-clock space, independently of official answers.
Prediction JSON: {game_id, events:[{period,clock,team,points,made}]}.
Only submit predictions from the truth file's selected window.
"""
import argparse
import json
from pathlib import Path

def seconds(clock):
    minute, second = clock.split(':')
    return int(minute)*60+float(second)

def evaluate(truth, predictions, tolerance=2):
    if predictions['game_id'] != truth['game_id']:
        raise ValueError('game_id mismatch')
    expected=truth['events']; proposed=predictions['events']
    candidates=sorted((abs(seconds(a['clock'])-seconds(b['clock'])),i,j)
        for i,a in enumerate(expected) for j,b in enumerate(proposed)
        if a['period']==b['period'] and a['team']==b['team']
        and abs(seconds(a['clock'])-seconds(b['clock']))<=tolerance)
    used_a=set();used_b=set();matches=[]
    for delta,i,j in candidates:
        if i in used_a or j in used_b: continue
        used_a.add(i);used_b.add(j)
        matches.append({'truth_id':expected[i]['id'],'prediction_index':j,'clock_error_s':delta,
          'made_correct':expected[i]['made']==proposed[j]['made'],
          'points_correct':expected[i]['points']==proposed[j]['points']})
    n=len(matches)
    return {'expected':len(expected),'predicted':len(proposed),'matched':n,
      'precision':n/len(proposed) if proposed else None,'recall':n/len(expected) if expected else None,
      'made_accuracy_on_matches':sum(m['made_correct'] for m in matches)/n if n else None,
      'points_accuracy_on_matches':sum(m['points_correct'] for m in matches)/n if n else None,
      'missed':[a['id'] for i,a in enumerate(expected) if i not in used_a],
      'unmatched_predictions':[j for j in range(len(proposed)) if j not in used_b],'matches':matches}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--truth',required=True);parser.add_argument('--predictions',required=True)
    args=parser.parse_args()
    print(json.dumps(evaluate(json.loads(Path(args.truth).read_text()),json.loads(Path(args.predictions).read_text())),indent=2))
