"""Turn review notes into explicit proposals, never approvals or label rewrites."""
import json,sqlite3,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def prepare(path):
 c=sqlite3.connect(path);c.row_factory=sqlite3.Row
 c.execute('PRAGMA foreign_keys=ON')
 c.executescript('''CREATE TABLE IF NOT EXISTS revision_proposals(
 task_key TEXT PRIMARY KEY,annotation_id TEXT NOT NULL REFERENCES annotations(id),
 human_review_id INTEGER NOT NULL REFERENCES human_decisions(id),
 annotation_hash TEXT NOT NULL,proposed_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status='needs_confirmation'));''')
 rows=c.execute('SELECT q.*,a.annotation_json FROM revision_queue q JOIN annotations a ON a.id=q.annotation_id').fetchall()
 before=c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]
 with c:
  for row in rows:
   proposal={'category':row['category'],'evidence_note':row['original_note'],'instruction':row['proposed_action'],'changes':{}}
   if row['category']=='definition_confirmation':
    payload=json.loads(row['annotation_json']);proposal['changes']={'object_definition':'hoop_region','description':'篮圈与篮网区域，不含篮板；不是仅篮圈','contains_target':bool(payload.get('objects'))}
   elif row['category']=='shot_type_enrichment':
    proposal['changes']={'shot_type':'floater' if '抛投' in row['original_note'] else 'layup' if '上篮' in row['original_note'] else 'unknown'}
   elif row['category']=='display_or_box_fix':proposal['changes']={'requires_zoomed_box_review':True}
   else:proposal['changes']={'requires_tactic_and_action_separation':True}
   c.execute('INSERT OR REPLACE INTO revision_proposals VALUES(?,?,?,?,?,?)',(row['task_key'],row['annotation_id'],row['human_review_id'],hashlib.sha256(row['annotation_json'].encode()).hexdigest(),json.dumps(proposal,ensure_ascii=False),'needs_confirmation'))
 assert c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]==before
 c.close();return len(rows)
if __name__=='__main__':print(prepare(ROOT/'data/library/library.db'),'proposals; original decisions unchanged')
