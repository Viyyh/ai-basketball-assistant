"""Product review boundaries: synthetic sources only, never private human decisions."""
import hashlib
import re
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from player_workbench import create_app, connect, state

class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name)/'review.db'
        self.media = Path(self.tmp.name)/'video.mp4'
        self.media.write_bytes(b'0123456789')
        self.client = TestClient(create_app(self.db))
        self.token = re.search(r"const TOKEN='([^']+)'",self.client.get('/').text)[1]
        self.headers = {'X-Review-Token':self.token}
        st = self.media.stat()
        with connect(self.db) as c:
            c.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)',('s','test.mp4',str(self.media),hashlib.sha256(self.media.read_bytes()).hexdigest(),100,st.st_size,st.st_mtime_ns,'session'))
            c.execute('INSERT INTO players(id,name,cue) VALUES(?,?,?)',('p','球员','2号'))
        self.body = dict(reviewer='test',viewed=True,version=0,source_id='s',player_id='p',start=10,end=12,kind='shot',action='layup',outcome='unknown',status='confirmed',note='test evidence')

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def post(self,key='e',**changes):
        return self.client.post('/api/events/'+key,json=self.body|changes,headers=self.headers)

    def confirm_player(self,status='confirmed',version=1):
        return self.client.post('/api/players/p',json=dict(reviewer='test',viewed=True,status=status,version=version),headers=self.headers)

    def report(self):
        return self.client.get('/api/state').json()['reports'][0]

    def test_no_automatic_identity_or_result(self):
        self.assertEqual(self.post().status_code,200)
        self.assertEqual(self.report()['confirmed_attempts'],0)
        self.confirm_player()
        r=self.report()
        self.assertEqual(r['confirmed_attempts'],1)
        self.assertEqual(r['unknown_outcomes'],1)
        self.assertIsNone(r['known_result_rate'])
        self.assertIsNone(r['measured_accuracy'])

    def test_unknown_excluded_from_denominator_and_evidence_preserved(self):
        self.confirm_player()
        self.post(outcome='made')
        self.post('b',start=20,end=22)
        r=self.report()
        self.assertEqual((r['confirmed_attempts'],r['made'],r['denominator']),(2,1,1))
        self.assertEqual(r['known_result_rate'],1)
        self.assertEqual(set(r['evidence_ids']),{'e','b'})

    def test_correction_recalculates_without_erasing_history(self):
        self.confirm_player();self.post(outcome='made')
        self.assertEqual(self.post(version=1,status='rejected',note='not a shot').status_code,200)
        self.assertEqual(self.report()['confirmed_attempts'],0)
        h=self.client.get('/api/export').json()['history']
        self.assertEqual(len([r for r in h if r['entity']=='event']),2)

    def test_stale_edit_is_rejected(self):
        self.post()
        self.assertEqual(self.post(outcome='made').status_code,409)
        self.assertEqual(self.client.get('/api/state').json()['events'][0]['outcome'],'unknown')

    def test_duplicate_confirmed_shot_is_blocked(self):
        self.post()
        self.assertEqual(self.post('other',start=11,end=13).status_code,409)
        self.assertEqual(self.post('other',start=12,end=13).status_code,200)

    def test_auth_and_explicit_viewing(self):
        self.assertEqual(self.client.post('/api/events/e',json=self.body).status_code,403)
        self.assertEqual(self.post(viewed=False).status_code,422)
        self.assertEqual(self.post(reviewer='   ').status_code,422)

    def test_invalid_times_and_incompatible_actions(self):
        for changes in [dict(start=-1),dict(end=101),dict(end=10),dict(kind='other',outcome='made'),dict(action='catch'),dict(start=True),dict(player_id=''),dict(kind='other',action='layup')]:
            self.assertEqual(self.post(**changes).status_code,422)
        self.assertEqual(self.post(player_id='missing').status_code,422)

    def test_unassigned_shots_do_not_get_assigned_to_someone(self):
        self.confirm_player();self.post(player_id=None)
        self.assertEqual(self.report()['confirmed_attempts'],0)
        self.assertIsNone(self.client.get('/api/state').json()['events'][0]['player_id'])

    def test_identity_revocation_removes_personal_counts(self):
        self.confirm_player();self.post(outcome='made')
        self.assertEqual(self.confirm_player('unconfirmed',2).status_code,200)
        self.assertEqual(self.report()['confirmed_attempts'],0)
        self.assertEqual(self.confirm_player(version=1).status_code,409)

    def test_coverage_union_and_withdrawal(self):
        for a,b in [(0,10),(5,15)]:
            r=self.client.post('/api/coverage',json=dict(reviewer='test',viewed=True,source_id='s',start=a,end=b),headers=self.headers)
            self.assertEqual(r.status_code,200)
        s=self.client.get('/api/state').json()
        self.assertEqual(s['sources'][0]['reviewed_seconds'],15)
        key=s['coverage'][0]['id']
        self.assertEqual(self.client.delete('/api/coverage/'+key+'?reviewer=test',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/state').json()['sources'][0]['reviewed_seconds'],10)

    def test_changed_original_fails_closed(self):
        self.confirm_player();self.post(outcome='made')
        self.media.write_bytes(b'changed')
        self.assertEqual(self.report()['confirmed_attempts'],0)
        self.assertEqual(self.client.get('/api/media/s').status_code,409)
        self.assertEqual(self.post(version=1).status_code,409)

    def test_media_range_and_no_local_paths_in_state(self):
        r=self.client.get('/api/media/s',headers={'Range':'bytes=2-5'})
        self.assertEqual(r.status_code,206)
        self.assertEqual(r.content,b'2345')
        self.assertNotIn(str(self.tmp.name),self.client.get('/api/state').text)

    def test_seed_import_is_idempotent_and_preserves_user_corrections(self):
        import json
        from prepare_player_session import prepare
        root=Path(self.tmp.name)/'root'
        (root/'data/library/intake').mkdir(parents=True)
        seed=dict(sources=['source-a'],players=[dict(id='athlete-1',name='示例球员',cue='合成身份线索')],events=[dict(id='candidate-1',source_id='source-a',player_id='athlete-1',start=10,end=12,kind='shot',action='unknown',note='合成动作候选')])
        (root/'data/library/player-session-proposals.local.json').write_text(json.dumps(seed))
        record=dict(id='source-a',filename='synthetic.mp4',path=str(self.media),sha256=hashlib.sha256(self.media.read_bytes()).hexdigest(),metadata={'format':{'duration':'100'}},group_id='session')
        (root/'data/library/intake/source-a.json').write_text(json.dumps(record))
        prepare(self.db,root)
        body=self.body|dict(version=1,source_id='source-a',player_id='athlete-1',start=10,end=12,status='uncertain',note='needs more context')
        self.assertEqual(self.client.post('/api/events/candidate-1',json=body,headers=self.headers).status_code,200)
        prepare(self.db,root)
        snapshot=self.client.get('/api/state').json()
        self.assertEqual(len(snapshot['events']),1)
        changed=snapshot['events'][0]
        self.assertEqual((changed['version'],changed['status']),(2,'uncertain'))
        self.assertTrue(all(p['status']=='unconfirmed' for p in snapshot['players']))

    def test_optional_settings_and_name_fallback(self):
        payload=dict(reviewer='test',viewed=True,version=0,preferences={'player_names':{'p':'测试姓名'},'format':'2v2','goals':['passing','off_ball']})
        self.assertEqual(self.client.post('/api/settings',json=payload,headers=self.headers).status_code,200)
        state=self.client.get('/api/state').json()
        self.assertEqual(state['players'][0]['display_name'],'测试姓名 · 球员')
        self.assertIsNone(state['settings']['preferences']['court_length_m'])
        self.assertEqual(self.client.post('/api/settings',json=payload,headers=self.headers).status_code,409)
        payload['version']=1;payload['preferences']['player_names']={'p':''}
        self.assertEqual(self.client.post('/api/settings',json=payload,headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/state').json()['players'][0]['display_name'],'球员')

    def test_settings_reject_invalid_geometry_and_rules(self):
        for prefs in [{'court_width_m':-1},{'court_length_m':True},{'inside_points':3,'outside_points':2},{'player_names':{'missing':'name'}}]:
            r=self.client.post('/api/settings',json=dict(reviewer='test',viewed=True,version=0,preferences=prefs),headers=self.headers)
            self.assertEqual(r.status_code,422)

if __name__=='__main__':unittest.main()
