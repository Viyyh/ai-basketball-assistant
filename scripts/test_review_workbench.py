import tempfile,sqlite3,re,unittest
from pathlib import Path
from fastapi.testclient import TestClient
from review_materials import create_app,ROOT
class WorkbenchTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'test.db'
  source=sqlite3.connect(ROOT/'data/library/library.db');dest=sqlite3.connect(self.path);source.backup(dest);source.close();dest.close()
  self.client=TestClient(create_app(self.path));page=self.client.get('/').text
  self.token=re.search("const token='([^']+)'",page).group(1);self.headers={'X-Review-Token':self.token}
  self.item=next(x for x in self.client.get('/api/queue').json() if x['kind']=='hoop_crop')
 def tearDown(self):self.client.close();self.temp.cleanup()
 def vote(self,**changes):
  body=dict(revision=self.item['revision'],decision='approved',reviewer='TEST ONLY',confirmed=True);body.update(changes)
  return self.client.post('/api/review/'+self.item['id'],headers=self.headers,json=body)
 def test_token_and_confirmation(self):
  self.assertEqual(self.client.post('/api/review/'+self.item['id'],json={}).status_code,422)
  self.assertEqual(self.vote(confirmed=False).status_code,422)
  headers=self.headers;self.headers={};self.assertEqual(self.vote().status_code,403);self.headers=headers
 def test_save_persist_and_revision_gate(self):
  self.assertEqual(self.vote().status_code,200)
  self.assertTrue(any(x['id']==self.item['id'] for x in self.client.get('/api/export').json()['records']))
  with sqlite3.connect(self.path) as c:c.execute('UPDATE annotations SET scope=?,review_json=? WHERE id=?',('changed','{}',self.item['id']))
  self.assertEqual(self.vote().status_code,409)
  self.assertFalse(any(x['id']==self.item['id'] for x in self.client.get('/api/export').json()['records']))
 def test_last_decision_wins_and_reason_required(self):
  self.assertEqual(self.vote().status_code,200)
  self.assertEqual(self.vote(decision='rejected').status_code,422)
  self.assertEqual(self.vote(decision='rejected',note='TEST reason').status_code,200)
  self.assertFalse(any(x['id']==self.item['id'] for x in self.client.get('/api/export').json()['records']))
 def test_tactic_needs_real_annotation(self):
  self.item=next(x for x in self.client.get('/api/queue').json() if x['kind']=='tactic_sample')
  self.assertEqual(self.vote().status_code,422)
  self.assertEqual(self.client.get('/api/media/'+self.item['id']).status_code,200)
if __name__=='__main__':unittest.main()
