import unittest
from basketball_pipeline.events import rim_crossing_candidates

def frame(t,y,segment=1):
 return {'source_seconds':t,'tentative_link':{'xyxy':[48,y-1,52,y+1],'segment':segment},'entities':[{'class':'hoop','xyxy':[40,40,60,50]}]}
class EventsTest(unittest.TestCase):
 def test_crossing_stays_unknown(self):
  e=rim_crossing_candidates([frame(0,38),frame(.2,43)])
  self.assertEqual(len(e),1);self.assertEqual(e[0]['outcome'],'unknown')
 def test_gaps_or_segments_do_not_join(self):
  self.assertEqual(rim_crossing_candidates([frame(0,38),frame(1,43)]),[])
  self.assertEqual(rim_crossing_candidates([frame(0,38),frame(.2,43,2)]),[])
