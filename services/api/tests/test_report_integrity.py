import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import create_app
class ReportIntegrityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.client=TestClient(create_app(self.tmp.name+'/test.db'));self.activity=self.client.post('/v1/activities',json={'title':'integrity'}).json();self.url='/v1/activities/'+self.activity['id']+'/report'
  self.report=json.loads((Path(__file__).resolve().parents[3]/'contracts/fixtures/sample-report.json').read_text());self.report['activity_id']=self.activity['id']
 def tearDown(self):self.client.close();self.tmp.cleanup()
 def test_corrupt_statistics_cannot_overwrite_valid_report(self):
  self.assertEqual(self.client.post(self.url,json=self.report).status_code,201)
  broken=json.loads(json.dumps(self.report));broken['team_stats']['points']=999
  self.assertEqual(self.client.post(self.url,json=broken).status_code,422)
  self.assertEqual(self.client.get(self.url).json()['team_stats']['points'],self.report['team_stats']['points'])
 def test_activity_snapshot_mismatch_rejected(self):
  self.report['params']['three_point_radius_m']=5
  self.assertEqual(self.client.post(self.url,json=self.report).status_code,422)
 def test_missing_validator_fails_closed(self):
  with patch('app.report_validation.find_node',return_value=None):self.assertEqual(self.client.post(self.url,json=self.report).status_code,503)
  self.assertEqual(self.client.get(self.url).status_code,404)
if __name__=='__main__':unittest.main()
