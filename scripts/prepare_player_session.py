"""Register local source manifests and assistant proposals, never human approvals.
Private session proposals remain under ignored data/, outside the code repository.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
from player_workbench import ROOT, initialize, connect

def prepare(db_path=None, root=ROOT, seed_path=None):
    root = Path(root)
    db = Path(db_path or root/'data/library/player-review.db')
    seed = json.loads(Path(seed_path or root/'data/library/player-session-proposals.local.json').read_text())
    source_ids = seed['sources']
    if not source_ids or len(set(source_ids)) != len(source_ids) or any(not re.fullmatch(r'[A-Za-z0-9_-]+',s) for s in source_ids):
        raise ValueError('Need unique safe source IDs')
    prepared=[]
    for key in source_ids:
        intake=json.loads((root/f'data/library/intake/{key}.json').read_text())
        if intake['id'] != key:
            raise ValueError('Source ID mismatch')
        path=Path(intake['path'])
        with path.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
        if sha != intake['sha256']:
            raise ValueError('Original content changed; do not import previous proposals')
        prepared.append((intake,path,sha,path.stat()))
    if len({row[0]['group_id'] for row in prepared}) != 1:
        raise ValueError('Use one related source group per player-review database')
    initialize(db)
    with connect(db) as c:
        groups={r[0] for r in c.execute('SELECT DISTINCT group_id FROM sources')}
        if groups and groups != {prepared[0][0]['group_id']}:
            raise ValueError('Database already belongs to another source group')
        for intake,path,sha,st in prepared:
            old=c.execute('SELECT sha256 FROM sources WHERE id=?',(intake['id'],)).fetchone()
            if old and old['sha256'] != sha:
                raise ValueError('Source ID already belongs to other content')
            c.execute('INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?,?,?,?)',
                      (intake['id'],intake['filename'],str(path),sha,float(intake['metadata']['format']['duration']),st.st_size,st.st_mtime_ns,intake['group_id']))
        for p in seed['players']:
            c.execute('INSERT OR IGNORE INTO players(id,name,cue) VALUES(?,?,?)',(p['id'],p['name'],p['cue']))
        for key,payload in seed.get('assistant_observations',{}).items():
            c.execute('INSERT OR IGNORE INTO observations VALUES(?,?)',(key,json.dumps(payload,ensure_ascii=False)))
        # Stable IDs preserve subsequent human corrections. Imported proposals stay candidates.
        for e in seed['events']:
            if e['source_id'] not in source_ids:
                raise ValueError('Proposal source not included in session')
            c.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?,1)',
                      (e['id'],e['source_id'],e['player_id'],e['start'],e['end'],e['kind'],e['action'],'unknown','candidate',e['note']))
    return db

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--seed',help='Local-only proposal JSON')
    p.add_argument('--db',help='Local session database')
    args=p.parse_args()
    print(prepare(args.db,seed_path=args.seed))
