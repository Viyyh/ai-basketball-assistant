"""Organize current reviews into release candidates, revision tasks and isolated external data.
Never changes original labels or human decisions.
"""
import sqlite3,json,hashlib
from pathlib import Path
from datetime import datetime,timezone,timedelta
ROOT=Path(__file__).resolve().parents[1]
def organize():
 path=ROOT/'data/library/library.db';c=sqlite3.connect(path);c.row_factory=sqlite3.Row
 backup=path.parent/'backups';backup.mkdir(exist_ok=True)
 stamp=datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S-%f')
 dest=sqlite3.connect(backup/f'library-before-organization-{stamp}.db');c.backup(dest);dest.close()
 before=c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]
 c.executescript('''CREATE TABLE IF NOT EXISTS review_tasks(
 task_key TEXT PRIMARY KEY,annotation_id TEXT NOT NULL REFERENCES annotations(id),
 human_review_id INTEGER NOT NULL REFERENCES human_decisions(id),category TEXT NOT NULL,
 original_note TEXT NOT NULL,proposed_action TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')));
 CREATE VIEW IF NOT EXISTS latest_human_reviews AS SELECT * FROM human_decisions WHERE id IN(SELECT MAX(id) FROM human_decisions GROUP BY annotation_id);
 CREATE VIEW IF NOT EXISTS revision_queue AS SELECT t.*,a.kind FROM review_tasks t JOIN annotations a ON a.id=t.annotation_id JOIN latest_human_reviews h ON h.id=t.human_review_id WHERE t.status='open';
 CREATE VIEW IF NOT EXISTS release_candidates AS SELECT h.* FROM human_clean_annotations h WHERE NOT EXISTS(SELECT 1 FROM revision_queue q WHERE q.annotation_id=h.id);
 CREATE VIEW IF NOT EXISTS rejected_records AS SELECT a.id,a.kind,h.note FROM annotations a JOIN latest_human_reviews h ON h.annotation_id=a.id WHERE h.decision='rejected';''')
 rows=c.execute('SELECT a.id annotation_id,a.kind,d.* FROM latest_human_reviews d JOIN annotations a ON a.id=d.annotation_id').fetchall()
 with c:
  for row in rows:
   if row['decision']!='uncertain':continue
   kind=row['kind']
   if kind=='hoop_crop':
    category='definition_confirmation';action='确认 hoop 是篮圈加篮网；无目标图仅作负样本。无需重新收集同类图。'
   elif kind=='frame':category='display_or_box_fix';action='补充放大框图，检查框坐标与显示；确认后再更新标签。'
   elif kind=='shot':category='shot_type_enrichment';action='根据意见补出手方式（上篮/抛投），保留分值和结果；修改后需复核。'
   else:category='tactic_taxonomy';action='区分单人动作、团队配合、无明确战术与过程不完整；补充参与者及时间，不能因未得分判战术失败。'
   key=hashlib.sha256(f'{row["id"]}:{category}'.encode()).hexdigest()
   c.execute('INSERT OR IGNORE INTO review_tasks VALUES(?,?,?,?,?,?,?)',(key,row['annotation_id'],row['id'],category,row['note'],action,'open'))
  for annotation,action in [('tactics-review-04','选项为其他无球切入，但文字描述溜底线；核对是否需要多标签。'),('tactics-review-05','选项为其他无球切入，文字包含借掩护突破与分球；核对掩护/突破分球等关系。')]:
   row=c.execute('SELECT * FROM latest_human_reviews WHERE annotation_id=?',(annotation,)).fetchone()
   if row and row['decision']=='approved':
    category='approved_label_consistency';key=hashlib.sha256(f'{row["id"]}:{category}'.encode()).hexdigest()
    c.execute('INSERT OR IGNORE INTO review_tasks VALUES(?,?,?,?,?,?,?)',(key,annotation,row['id'],category,row['note'],action,'open'))
 assert c.execute('SELECT count(*) FROM human_decisions').fetchone()[0]==before
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not c.execute('PRAGMA foreign_key_check').fetchall()
 summary={'sources':c.execute('SELECT count(*) FROM sources').fetchone()[0],'annotation_records':c.execute('SELECT count(*) FROM annotations').fetchone()[0],'human_latest':{r[0]:r[1] for r in c.execute('SELECT decision,count(*) FROM latest_human_reviews GROUP BY decision')},'revision_categories':{r[0]:r[1] for r in c.execute('SELECT category,count(*) FROM revision_queue GROUP BY category')},'release_candidates':c.execute('SELECT count(*) FROM release_candidates').fetchone()[0],'training_ready':c.execute('SELECT count(*) FROM training_annotations').fetchone()[0],'external_records':c.execute('SELECT count(*) FROM external_records').fetchone()[0],'external_events':c.execute('SELECT count(*) FROM external_events').fetchone()[0],'model_candidates':c.execute('SELECT count(*) FROM candidates').fetchone()[0],'scope':'release candidates are scoped approvals, not training-ready or exact gold'}
 out=ROOT/'data/library';(out/'organized-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 tasks=[dict(r) for r in c.execute('SELECT * FROM revision_queue ORDER BY category,annotation_id')];(out/'revision-tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2)+'\n')
 parts=['<meta charset="utf-8"><title>数据库整理与待办</title><style>body{background:#142238;color:white;font:16px/1.7 sans-serif;max-width:1100px;margin:40px auto;padding:20px}article{background:#243951;padding:20px;margin:16px 0;border-radius:12px}pre{white-space:pre-wrap}a{color:#8fe2ca}</style><h1>数据库整理与待办</h1><p>保留全部人类决定；以下为修改提案，不是自动批准。12条可作限定用途发布候选，训练就绪仍为0。</p><pre>'+json.dumps(summary,ensure_ascii=False,indent=2)+'</pre><h2>待处理记录</h2>']
 for t in tasks:parts.append('<article><h3>'+t['annotation_id']+'</h3><p>原意见：'+__import__('html').escape(t['original_note'])+'</p><p>处理建议：'+t['proposed_action']+'</p></article>')
 (out/'organized.html').write_text('\n'.join(parts));c.close();print(json.dumps(summary,ensure_ascii=False,indent=2))
if __name__=='__main__':organize()
