import unittest
from evaluate_shot_events import evaluate

def event(key,time=10,source='s',**extra):
    return dict(id=key,source_id=source,time_s=time)|extra

def ref(events):
    return dict(exhaustive=True,reviewed_windows=[dict(source_id='s',start=0,end=30)],events=events)

class EvaluationTests(unittest.TestCase):
    def test_duplicate_predictions_are_not_multiple_true_positives(self):
        r=evaluate({'events':[event('p'),event('duplicate')]},ref([event('g')]))
        self.assertEqual((r['true_positive'],r['false_positive'],r['recall']),(1,1,1))
        self.assertEqual(r['precision'],.5)

    def test_matching_finds_maximum_not_greedy_first_match(self):
        r=evaluate({'events':[event('p1',10),event('p2',10.5)]},ref([event('g1',9.6),event('g2',10.1)]),.5)
        self.assertEqual(r['true_positive'],2)

    def test_unknown_result_is_not_success_or_miss(self):
        r=evaluate({'events':[event('p',outcome='unknown')]},ref([event('g',outcome='made')]))
        self.assertEqual(r['result_abstentions'],1)
        self.assertEqual(r['result_accuracy_including_abstentions'],0)
        self.assertIsNone(r['result_accuracy_when_answered'])

    def test_wrong_identity_does_not_hide_detection_error(self):
        r=evaluate({'events':[event('p',player_id='other',outcome='made')]},ref([event('g',player_id='p',outcome='made')]))
        self.assertEqual(r['true_positive'],1)
        self.assertEqual(r['identity_accuracy_on_matched_events'],0)
        self.assertEqual(r['result_accuracy_when_answered'],1)

    def test_predictions_outside_reviewed_scope_are_excluded(self):
        r=evaluate({'events':[event('p',50),event('other',10,'another')]},ref([]))
        self.assertEqual(r['false_positive'],0)
        self.assertEqual(r['excluded_unreviewed_predictions'],2)
        self.assertIsNone(r['precision'])

    def test_negative_windows_can_measure_false_positives(self):
        r=evaluate({'events':[event('p')]},ref([]))
        self.assertEqual(r['false_positive'],1)
        self.assertIsNone(r['recall'])

    def test_missing_predictions_give_false_negatives(self):
        r=evaluate({'events':[]},ref([event('g')]))
        self.assertEqual(r['false_negative'],1)
        self.assertEqual(r['recall'],0)

    def test_fail_closed_without_exhaustive_scope(self):
        for r in [dict(events=[]),dict(exhaustive=False,reviewed_windows=[dict(source_id='s',start=0,end=10)])]:
            with self.assertRaises(ValueError):evaluate({'events':[]},r)

    def test_invalid_times_and_reference_outside_scope(self):
        for e in [event('g',float('nan')),event('g',True),event('g',31),dict(id='g',source_id='s',start=1,end=2)]:
            with self.assertRaises(ValueError):evaluate({'events':[]},ref([e]))
        with self.assertRaises(ValueError):evaluate({'events':[]},ref([]),-1)

    def test_duplicate_ids_rejected(self):
        with self.assertRaises(ValueError):evaluate({'events':[event('p'),event('p')]},ref([]))

    def test_missing_events_cannot_silently_become_negative_labels(self):
        with self.assertRaises(ValueError):evaluate({},ref([]))
        with self.assertRaises(ValueError):evaluate({'events':[]},dict(exhaustive=True,reviewed_windows=[dict(source_id='s',start=0,end=20)]))

if __name__=='__main__':unittest.main()
