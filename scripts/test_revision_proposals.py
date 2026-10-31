import tempfile,sqlite3,unittest
from pathlib import Path
from prepare_revision_proposals import prepare,ROOT
class ProposalTests(unittest.TestCase):
 def test_idempotent_and_no_automatic_approval(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'test.db';source=sqlite3.connect(ROOT/'data/library/library.db');dest=sqlite3.connect(p);source.backup(dest);source.close();dest.close()
   c=sqlite3.connect(p);before=list(c.execute('SELECT id,decision,correction_json FROM human_decisions ORDER BY id'));expected=c.execute('SELECT count(*) FROM revision_queue').fetchone()[0];existing=c.execute('SELECT count(*) FROM revision_proposals').fetchone()[0];c.close()
   self.assertEqual(prepare(p),expected);self.assertEqual(prepare(p),expected)
   c=sqlite3.connect(p);self.assertGreaterEqual(c.execute('SELECT count(*) FROM revision_proposals').fetchone()[0],max(existing,expected));self.assertEqual(before,list(c.execute('SELECT id,decision,correction_json FROM human_decisions ORDER BY id')));self.assertEqual(c.execute('SELECT count(*) FROM training_annotations').fetchone()[0],0);c.close()
if __name__=='__main__':unittest.main()
