import copy,json,re,sqlite3,tempfile,unittest
from pathlib import Path
from fastapi.testclient import TestClient
from audit_external_annotations import audit
from review_external import create_app,ROOT
class AuditTests(unittest.TestCase):
 def row(self):return {'events':[{'event_id':'1','event_label':'Putback','player':'Player','result':'made','caption':'Player makes putback.','timestamp_video':{'start':'00:00','end':'01:20'}}]}
 def test_normalization_preserves_raw_and_time_unknown(self):
  original=self.row();r,flags=audit(original);self.assertEqual(original['events'][0]['event_label'],'Putback');self.assertEqual(r['events'][0]['canonical_label'],'PutBack');self.assertIsNone(r['events'][0]['start_seconds'])
 def test_zero_interval_and_conflicting_caption(self):
  r=self.row();r['events'][0]['timestamp_video']['end']='00:00';r['events'][0]['caption']='Player misses shot.'
  codes={f['code'] for f in audit(r)[1]};self.assertIn('nonpositive_interval',codes);self.assertIn('caption_outcome_conflict',codes)
 def test_duplicate_event_id(self):
  r=self.row();r['events'].append(copy.deepcopy(r['events'][0]));self.assertIn('missing_or_duplicate_event_id',{f['code'] for f in audit(r)[1]})
 def test_review_requires_evidence(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/'test.db';a=sqlite3.connect(ROOT/'data/library/library.db');b=sqlite3.connect(p);a.backup(b);a.close();original_count=b.execute('SELECT count(*) FROM human_decisions').fetchone()[0];b.close();client=TestClient(create_app(p))
   token=re.search("const token='([^']+)'",client.get('/').text).group(1)
   rows=client.get('/api/samples').json();self.assertEqual(len(rows),29);self.assertEqual(sum(r['media_available'] for r in rows),9)
   row=next(r for r in rows if not r['media_available']);body={'revision':row['revision'],'decision':'visually_consistent_target','reviewer':'TEST ONLY','confirmed':True}
   self.assertEqual(client.post('/api/review/'+row['id'],headers={'X-Review-Token':token},json=body).status_code,422)
   row=next(r for r in rows if r['media_available']);body['revision']=row['revision'];self.assertEqual(client.post('/api/review/'+row['id'],json=body).status_code,403)
   self.assertEqual(client.post('/api/review/'+row['id'],headers={'X-Review-Token':token},json=body).status_code,200)
   body['revision']='stale';self.assertEqual(client.post('/api/review/'+row['id'],headers={'X-Review-Token':token},json=body).status_code,409)
   c=sqlite3.connect(p);self.assertEqual(c.execute('SELECT count(*) FROM human_decisions').fetchone()[0],original_count);c.close()
if __name__=='__main__':unittest.main()
