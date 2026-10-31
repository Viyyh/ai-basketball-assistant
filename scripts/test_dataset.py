import copy,importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('dataset',ROOT/'scripts/dataset.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DatasetTests(unittest.TestCase):
 def setUp(self):
  self.m=json.loads((ROOT/'datasets/manifest.json').read_text());self.r=[json.loads(x) for x in (ROOT/self.m['annotation_file']).read_text().splitlines()]
 def test_seed_valid(self):self.assertEqual(sum(module.validate(self.m,self.r).values()),12)
 def test_duplicate_rejected(self):
  with self.assertRaises(ValueError):module.validate(self.m,self.r+[self.r[0]])
 def test_split_rejected(self):
  self.r[0]['split']='test'
  with self.assertRaises(ValueError):module.validate(self.m,self.r)
 def test_box_rejected(self):
  self.r[-1]['annotation']['objects'][0]['xyxy']=[0,0,9999,20]
  with self.assertRaises(ValueError):module.validate(self.m,self.r)
 def test_partial_data_cannot_train(self):
  with self.assertRaises(ValueError):module.export(self.m,self.r,'/tmp/not-written-basketball-labels')
if __name__=='__main__':unittest.main()
