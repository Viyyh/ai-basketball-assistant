import tempfile,unittest,sqlite3
from pathlib import Path
from library_db import ingest,connect,status
class LibraryTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/'test.db'
  self.sources=[dict(id='s',group_id='g',filename='v.mp4',path='/test/v.mp4',sha256='a'*64,bytes=1,admission='registered_original')]
  self.records=[dict(id='a',source_id='s',kind='frame',admission='accepted_scoped',media_path='test.jpg',sha256='b'*64,scope='approximate',training_ready=False,exact_gold_label=False,annotation_payload={'objects':[]})]
 def tearDown(self):self.tmp.cleanup()
 def test_idempotent_and_provenance(self):
  ingest(self.db,self.sources,self.records,[],[]);s=ingest(self.db,self.sources,self.records,[],[])
  self.assertEqual(s['annotations'],1);self.assertEqual(s['reviews'],1);self.assertEqual(s['imports'],1);self.assertEqual(s['training_annotations'],0)
 def test_failure_rolls_back(self):
  ingest(self.db,self.sources,self.records,[],[])
  self.records[0]['source_id']='missing'
  with self.assertRaises(sqlite3.IntegrityError):ingest(self.db,self.sources,self.records,[],[])
  c=connect(self.db);self.assertEqual(c.execute('SELECT source_id FROM annotations').fetchone()[0],'s');c.close()
 def test_quarantine_cannot_be_training(self):
  self.records[0].update(admission='quarantined_pending',training_ready=True)
  with self.assertRaises(sqlite3.IntegrityError):ingest(self.db,self.sources,self.records,[],[])
 def test_review_history_preserved(self):
  ingest(self.db,self.sources,self.records,[],[])
  self.records[0]['admission']='restricted_reference';s=ingest(self.db,self.sources,self.records,[],[])
  self.assertEqual(s['reviews'],2)
if __name__=='__main__':unittest.main()
