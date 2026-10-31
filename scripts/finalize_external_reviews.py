"""Publish revision-current, target-only external approvals; never approve whole possessions."""
import json,sqlite3,hashlib
from pathlib import Path
from datetime import datetime,timezone,timedelta
ROOT=Path(__file__).resolve().parents[1]
def revision(row):
 details=json.loads(row['details_json']);media_hash=None
 if row['media_path']:
  with (ROOT/row['media_path']).open('rb') as f:media_hash=hashlib.file_digest(f,'sha256').hexdigest()
 return hashlib.sha256(json.dumps([row['raw_sha256'],details,media_hash],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
if __name__=='__main__':
 path=ROOT/'data/library/library.db';c=sqlite3.connect(path);c.row_factory=sqlite3.Row
 stamp=datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S-%f');backup=path.parent/'backups';backup.mkdir(exist_ok=True)
 dest=sqlite3.connect(backup/f'library-before-external-finalize-{stamp}.db');c.backup(dest);dest.close()
 c.executescript('''CREATE TABLE IF NOT EXISTS confirmed_external_targets(
 sample_id TEXT PRIMARY KEY REFERENCES external_review_samples(id),review_id INTEGER NOT NULL REFERENCES external_sample_reviews(id),
 reviewed_revision TEXT NOT NULL,media_path TEXT NOT NULL,target_json TEXT NOT NULL,
 training_ready INTEGER NOT NULL CHECK(training_ready=0),scope TEXT NOT NULL);''')
 rows=c.execute('''SELECT s.*,r.raw_sha256,d.id review_id,d.revision,d.decision,d.note,d.correction_json
 FROM external_review_samples s JOIN external_records r ON r.id=s.record_id
 JOIN external_sample_reviews d ON d.sample_id=s.id
 WHERE d.id IN(SELECT max(id) FROM external_sample_reviews GROUP BY sample_id)''').fetchall()
 current=[];stale=[]
 for row in rows:
  if row['decision']!='visually_consistent_target':continue
  if not row['media_path'] or revision(row)!=row['revision']:stale.append(row['id']);continue
  detail=json.loads(row['details_json']);event=detail.get('external_event')
  if not event:continue
  current.append({'sample_id':row['id'],'record_id':row['record_id'],'event_id':row['event_id'],'review_id':row['review_id'],'revision':row['revision'],'media_path':row['media_path'],'external_event':event,'human_note':row['note'],'correction':json.loads(row['correction_json']),'scope':'human confirmed target shot only; other possession events unverified; precise timing unresolved','training_ready':False})
 with c:
  # Derived table only: immutable human decisions and upstream records are untouched.
  c.execute('DELETE FROM confirmed_external_targets')
  for row in current:c.execute('INSERT INTO confirmed_external_targets VALUES(?,?,?,?,?,?,?)',(row['sample_id'],row['review_id'],row['revision'],row['media_path'],json.dumps(row,ensure_ascii=False),0,row['scope']))
 out=ROOT/'data/library';(out/'confirmed-external-targets.json').write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n')
 summary={'reviewed_samples':len(rows),'confirmed_targets':len(current),'stale_approvals':stale,'unreviewed_representatives':c.execute('SELECT count(*) FROM external_review_samples').fetchone()[0]-len(rows),'whole_possessions_visually_verified':0,'external_training_ready':0,'notes':'Nine target reviews do not validate all 31964 upstream events. Floater note retained without changing original Layup/2ptShot taxonomy.'}
 (out/'external-review-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not c.execute('PRAGMA foreign_key_check').fetchall();print(json.dumps(summary,ensure_ascii=False,indent=2));c.close()
