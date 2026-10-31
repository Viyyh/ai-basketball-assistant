"""Import PL-NBA annotations into an isolated external staging area, not clean labels."""
import json,sqlite3,zipfile,hashlib
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
 archive=ROOT/'data/public-sources/pl-nba-annotations.zip';digest=hashlib.sha256(archive.read_bytes()).hexdigest()
 conn=sqlite3.connect(ROOT/'data/library/library.db');conn.execute('PRAGMA foreign_keys=ON')
 conn.executescript('''CREATE TABLE IF NOT EXISTS external_sources(
 id TEXT PRIMARY KEY,url TEXT NOT NULL,license TEXT NOT NULL,archive_sha256 TEXT NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS external_records(
 id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES external_sources(id),group_id TEXT NOT NULL,
 source_member TEXT NOT NULL,raw_sha256 TEXT NOT NULL,raw_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status='external_unverified'),media_status TEXT NOT NULL CHECK(media_status='not_downloaded'),
 training_ready INTEGER NOT NULL CHECK(training_ready=0));
 CREATE INDEX IF NOT EXISTS external_group ON external_records(source_id,group_id);''')
 existing=conn.execute('SELECT archive_sha256 FROM external_sources WHERE id=?',('pl-nba',)).fetchone()
 if existing and existing[0]!=digest:raise ValueError('Source archive changed; use a new version before import')
 counts=Counter();groups=set();valid=0;invalid=[];events=0
 with zipfile.ZipFile(archive) as z,conn:
  conn.execute('INSERT OR REPLACE INTO external_sources VALUES(?,?,?,?,?)',('pl-nba','https://github.com/holhouse/PL-NBA-Dataset','CC BY-NC 4.0; research staging only',digest,'annotations_only_unverified'))
  for item in z.infolist():
   if not item.filename.endswith('.json'):continue
   if item.file_size>2*1024*1024:raise ValueError('Unexpected large member')
   data=z.read(item)
   try:
    record=json.loads(data)
    if not isinstance(record,dict) or not isinstance(record.get('events'),list) or not record.get('video_id'):raise ValueError('Missing expected fields')
   except (ValueError,UnicodeDecodeError) as e:invalid.append({'member':item.filename,'error':str(e)});continue
   group=str(record['video_id']);groups.add(group)
   for event in record['events']:
    counts[str(event.get('event_label','unknown'))]+=1;events+=1
   conn.execute('INSERT OR IGNORE INTO external_records VALUES(?,?,?,?,?,?,?,?,?)',('pl-nba:'+item.filename,'pl-nba',group,item.filename,hashlib.sha256(data).hexdigest(),json.dumps(record,ensure_ascii=False),'external_unverified','not_downloaded',0));valid+=1
 summary={'source':'PL-NBA','source_url':'https://github.com/holhouse/PL-NBA-Dataset','archive_sha256':digest,'imported_possession_records':valid,'underlying_game_groups':len(groups),'event_entries':events,'event_labels':dict(counts),'invalid_members':invalid,'media_files_downloaded':0,'human_confirmed':0,'training_ready':0,'notes':['External source labels retained verbatim, not independently verified.','Do not assume action labels equal team tactics.','Timestamp notation remains raw until time-base definition is verified.','CC BY-NC 4.0: do not silently incorporate in commercial training.','No effect on current human decisions or clean annotation view.']}
 out=ROOT/'datasets/public';out.mkdir(exist_ok=True);(out/'pl-nba-import.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 conn.executescript("""CREATE VIEW IF NOT EXISTS external_events AS SELECT r.id AS possession_record_id,r.group_id,r.source_id, CASE json_extract(e.value,'$.event_label') WHEN 'Putback' THEN 'PutBack' WHEN 'nan' THEN 'unknown' ELSE json_extract(e.value,'$.event_label') END AS action, json_extract(e.value,'$.player') AS player,json_extract(e.value,'$.result') AS result,json_extract(e.value,'$.timestamp_video') AS raw_timestamp,r.status,r.media_status,r.training_ready FROM external_records r,json_each(r.raw_json,'$.events') e;""")
 assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 print(json.dumps(summary,ensure_ascii=False,indent=2));conn.close()
