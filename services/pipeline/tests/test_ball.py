import unittest
from basketball_pipeline.ball import BallLinker,merge_candidates,iou

def box(x,confidence=.8):
    return {'xyxy':[x,10,x+10,20],'confidence':confidence,'source':'full'}

class BallTests(unittest.TestCase):
    def test_overlap_merge_keeps_best_and_distinct(self):
        self.assertEqual(len(merge_candidates([box(10,.6),box(11,.9),box(100)])),2)
        self.assertEqual(merge_candidates([box(10,.6),box(11,.9)])[0]['confidence'],.9)
        self.assertEqual(iou([0,0,0,0],[0,0,0,0]),0)
    def test_gap_and_reset_never_bridge_identity(self):
        linker=BallLinker()
        first=linker.update([box(10)],0,1920,1080)
        self.assertIsNone(linker.update([], .1,1920,1080))
        nearby=linker.update([box(20),box(500,.99)],.2,1920,1080)
        self.assertEqual(nearby['segment'],first['segment'])
        self.assertEqual(nearby['xyxy'][0],20)
        later=linker.update([box(20)],1,1920,1080)
        self.assertNotEqual(later['segment'],nearby['segment'])
        linker.reset()
        self.assertNotEqual(linker.update([box(20)],1.1,1920,1080)['segment'],later['segment'])
