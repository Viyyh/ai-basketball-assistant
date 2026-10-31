"""Audited local media catalog. Media remains on disk; imports are transactional."""
import argparse,hashlib,json,sqlite3
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCHEMA='''
CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL, filename TEXT NOT NULL,
 path TEXT NOT NULL, sha256 TEXT, bytes INTEGER, admission TEXT NOT NULL,
 metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS annotations (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
 kind TEXT NOT NULL, admission TEXT NOT NULL CHECK(admission IN
 ('accepted_scoped','restricted_reference','restricted_missing_original','quarantined_pending')),
 media_path TEXT NOT NULL, sha256 TEXT NOT NULL, scope TEXT NOT NULL,
 training_ready INTEGER NOT NULL CHECK(training_ready IN(0,1)),
 exact_gold_label INTEGER NOT NULL CHECK(exact_gold_label IN(0,1)),
 annotation_json TEXT NOT NULL, review_json TEXT NOT NULL,
 CHECK(admission='accepted_scoped' OR (training_ready=0 AND exact_gold_label=0)));
CREATE TABLE IF NOT EXISTS reviews (
 annotation_id TEXT NOT NULL REFERENCES annotations(id), revision_hash TEXT NOT NULL,
 snapshot TEXT NOT NULL, payload_json TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(annotation_id,revision_hash));
CREATE TABLE IF NOT EXISTS candidates (
 candidate_key TEXT PRIMARY KEY, source_file TEXT NOT NULL, candidate_id TEXT NOT NULL,
 admission TEXT NOT NULL CHECK(admission='quarantined_model_candidate'),payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS imports (
 content_hash TEXT PRIMARY KEY, imported_at TEXT NOT NULL, summary_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS annotations_source ON annotations(source_id);
CREATE INDEX IF NOT EXISTS annotations_status ON annotations(admission,kind);
CREATE VIEW IF NOT EXISTS training_annotations AS
 SELECT * FROM annotations WHERE admission='accepted_scoped' AND training_ready=1;
PRAGMA user_version=1;
'''
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def connect(path):
 c=sqlite3.connect(path);c.execute('PRAGMA foreign_keys=ON');c.row_factory=sqlite3.Row;return c

def ingest(path,sources,records,candidates,history):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 if len({s['id'] for s in sources})!=len(sources):raise ValueError('Duplicate source ID')
 if len({r['id'] for r in records})!=len(records):raise ValueError('Duplicate annotation ID')
 stamp=datetime.now(timezone.utc).isoformat();fingerprint=sha([sources,records,candidates,history])
 c=connect(path)
 try:
  c.executescript(SCHEMA)
  with c:
   if c.execute('SELECT 1 FROM imports WHERE content_hash=?',(fingerprint,)).fetchone():return status(c)
   for s in sources:
    c.execute('''INSERT INTO sources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
     group_id=excluded.group_id,filename=excluded.filename,path=excluded.path,sha256=excluded.sha256,
     bytes=excluded.bytes,admission=excluded.admission,metadata_json=excluded.metadata_json''',
     (s['id'],s['group_id'],s['filename'],s['path'],s.get('sha256'),s.get('bytes'),s['admission'],canonical(s)))
   for r in records:
    c.execute('''INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
     source_id=excluded.source_id,kind=excluded.kind,admission=excluded.admission,
     media_path=excluded.media_path,sha256=excluded.sha256,scope=excluded.scope,
     training_ready=excluded.training_ready,exact_gold_label=excluded.exact_gold_label,
     annotation_json=excluded.annotation_json,review_json=excluded.review_json''',
     (r['id'],r['source_id'],r['kind'],r['admission'],r['media_path'],r['sha256'],r['scope'],int(r['training_ready']),int(r['exact_gold_label']),canonical(r['annotation_payload']),canonical({k:v for k,v in r.items() if k!='annotation_payload'})))
   for snapshot,rows in history+[('current',records)]:
    for r in rows:
     c.execute('INSERT OR IGNORE INTO reviews VALUES(?,?,?,?,?)',(r['id'],sha(r),snapshot,canonical(r),stamp))
   for r in candidates:
    c.execute('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?)',(sha(r),r['source_file'],r['id'],r['admission'],canonical(r)))
   c.execute('INSERT INTO imports VALUES(?,?,?)',(fingerprint,stamp,canonical(status(c))))
  assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  assert not c.execute('PRAGMA foreign_key_check').fetchall()
  return status(c)
 finally:c.close()

def status(c):
 return {**{name:c.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in ['sources','annotations','reviews','candidates','imports','training_annotations']},'admissions':{r[0]:r[1] for r in c.execute('SELECT admission,count(*) FROM annotations GROUP BY admission')}}

def collect(rehash=False):
 from check_material_library import validate
 validate();base=ROOT/'datasets/library';sources=json.loads((ROOT/'data/library/sources.local.json').read_text())
 for s in sources:
  p=Path(s['path'])
  if s['admission']=='registered_original':
   if not p.is_file() or p.stat().st_size!=s['bytes']:raise ValueError('Source missing or size changed: '+s['filename'])
   if rehash:
    with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    if h!=s['sha256']:raise ValueError('Source hash mismatch: '+s['filename'])
 records=[json.loads(x) for x in (base/'records-v0.1.jsonl').read_text().splitlines()];cache={}
 for r in records:
  filename=r['original_annotation_file']
  if filename not in cache:cache[filename]={x['id']:x for x in map(json.loads,(ROOT/filename).read_text().splitlines())}
  r['annotation_payload']=cache[filename][r['id']]
 candidates=json.loads((ROOT/'data/library/machine-quarantine.json').read_text())
 history=[(p.name,[json.loads(x) for x in p.read_text().splitlines()]) for p in sorted((base/'history').glob('*records*.jsonl'))]
 return sources,records,candidates,history

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['import','status','list']);p.add_argument('--db',default=str(ROOT/'data/library/library.db'));p.add_argument('--rehash-originals',action='store_true');p.add_argument('--admission');a=p.parse_args()
 if a.action=='import':print(json.dumps(ingest(a.db,*collect(a.rehash_originals)),ensure_ascii=False,indent=2))
 else:
  if not Path(a.db).is_file():p.error('Database does not exist; import first')
  c=sqlite3.connect('file:'+str(Path(a.db).resolve())+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
  try:
   if a.action=='status':print(json.dumps(status(c),ensure_ascii=False,indent=2))
   else:
    query='SELECT id,source_id,kind,admission,training_ready FROM annotations';values=()
    if a.admission:query+=' WHERE admission=?';values=(a.admission,)
    print(json.dumps([dict(r) for r in c.execute(query+' ORDER BY id',values)],ensure_ascii=False,indent=2))
  finally:c.close()
