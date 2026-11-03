import hashlib,json,re,tempfile,unittest
from pathlib import Path
from fastapi.testclient import TestClient
from review_acquired import create_app,ROOT
class AcquiredTests(unittest.TestCase):
 def test_review_gate_version_and_training_boundary(self):
  # Synthetic file under allowed data root; no real media or real votes.
  with tempfile.TemporaryDirectory(dir=ROOT/'data') as tmp:
   p=Path(tmp);media=p/'synthetic.mp4';media.write_bytes(b'synthetic-test-video')
   row=dict(id='sample',path=str(media.relative_to(ROOT)),sha256=hashlib.sha256(media.read_bytes()).hexdigest(),duration=10,source_url='https://example.invalid',source_start=0)
   manifest=p/'manifest.json';manifest.write_text(json.dumps({'records':[row]}))
   client=TestClient(create_app(p/'test.db',manifest));token=re.search("const token='([^']+)'",client.get('/').text)[1]
   r=client.get('/api/queue').json()[0]
   body=dict(revision=r['revision'],reviewer='synthetic',viewed=True,decision='confirmed',tags=['pass','catch'],start=1,end=5,participants='A passes to B',note='synthetic evidence')
   self.assertEqual(client.post('/api/review/sample',json=body).status_code,403)
   headers={'X-Review-Token':token}
   self.assertEqual(client.post('/api/review/sample',json=body|{'tags':['invented']},headers=headers).status_code,422)
   self.assertEqual(client.post('/api/review/sample',json=body|{'end':11},headers=headers).status_code,422)
   result=client.post('/api/review/sample',json=body,headers=headers)
   self.assertEqual(result.status_code,200);self.assertFalse(result.json()['training_ready'])
   self.assertEqual(client.post('/api/review/sample',json=body,headers=headers).status_code,409)
   media.write_bytes(b'changed');self.assertEqual(client.get('/api/media/sample').status_code,409)
if __name__=='__main__':unittest.main()
