import tempfile,unittest
from fastapi.testclient import TestClient
from app.main import create_app
class BoundaryTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.client=TestClient(create_app(self.temp.name+'/test.db'))
 def tearDown(self):self.client.close();self.temp.cleanup()
 def test_bad_enum_in_preset_is_client_error(self):
  for key in ['format','age_group']:
   self.assertEqual(self.client.get('/v1/params/resolve',params={'base':'fiba',key:'INVALID'}).status_code,400)
 def test_activity_limit_is_bounded(self):
  for limit in [-1,0,201]:self.assertEqual(self.client.get('/v1/activities',params={'limit':limit}).status_code,422)
if __name__=='__main__':unittest.main()
