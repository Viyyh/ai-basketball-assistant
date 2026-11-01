"""Gateway tests use synthetic accounts/backends, never personal videos or passwords."""
import base64
import json
from pathlib import Path
import tempfile
import unittest
import httpx
from fastapi.testclient import TestClient
from review_gateway import create_app, password_hash, private_write

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.config=Path(self.temp.name)/'access.json'
        self.config_data={'allowed_hosts':['testserver','example.test'],'public_origin':'https://example.test','users':{
          'owner':password_hash('test-owner')|{'enabled':True,'role':'admin','apps':{'player':'review','materials':'review'}},
          'reviewer':password_hash('test-reviewer')|{'enabled':True,'role':'reviewer','apps':{'player':'review'}},
          'viewer':password_hash('test-viewer')|{'enabled':True,'role':'viewer','apps':{'player':'view'}}}}
        private_write(self.config,self.config_data);self.forwarded=[]
        def backend(request):
            self.forwarded.append(request)
            if request.url.path=='/':return httpx.Response(200,text="<html><body><input id='reviewer'><script>fetch('/api/state')</script></body></html>",headers={'Content-Type':'text/html'})
            if request.headers.get('range'):return httpx.Response(206,content=b'2345',headers={'Content-Range':'bytes 2-5/10','Accept-Ranges':'bytes'})
            return httpx.Response(200,json={'saved':True})
        self.client=TestClient(create_app(self.config,httpx.MockTransport(backend)),base_url='https://testserver')
        self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None,None,None);self.temp.cleanup()
    def auth(self,user='reviewer'):
        return {'Authorization':'Basic '+base64.b64encode((user+':test-'+user).encode()).decode()}
    def test_anonymous_cannot_read_any_page_api_or_video(self):
        for url in ['/','/player/','/player/api/state','/player/api/media/video','/materials/api/export','/data/library.db']:
            self.assertEqual(self.client.get(url).status_code,401)
        self.assertFalse(self.forwarded)
    def test_whitelist_and_disabled_account(self):
        self.assertEqual(self.client.get('/',headers=self.auth()).status_code,200)
        self.config_data['users']['reviewer']['enabled']=False;private_write(self.config,self.config_data)
        self.assertEqual(self.client.get('/',headers=self.auth()).status_code,401)
    def test_account_cannot_enter_other_app_or_export(self):
        for path in ['/materials/','/player/api/export','/player/openapi.json','/player/data/library.db']:
            self.assertEqual(self.client.get(path,headers=self.auth()).status_code,403)
    def test_viewer_cannot_write_even_with_token_and_origin(self):
        r=self.client.post('/player/api/events/e',headers=self.auth('viewer')|{'Origin':'https://example.test'},json={'reviewer':'forged'})
        self.assertEqual(r.status_code,403);self.assertFalse(self.forwarded)
    def test_write_origin_required_and_identity_is_overridden(self):
        path='/player/api/events/e'
        self.assertEqual(self.client.post(path,headers=self.auth(),json={}).status_code,403)
        self.assertEqual(self.client.post(path,headers=self.auth()|{'Origin':'https://evil.test'},json={}).status_code,403)
        r=self.client.post(path,headers=self.auth()|{'Origin':'https://example.test'},json={'reviewer':'forged','note':'a'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(json.loads(self.forwarded[-1].content)['reviewer'],'reviewer')
        self.assertNotIn('authorization',self.forwarded[-1].headers)
    def test_delete_reviewer_query_is_overridden(self):
        r=self.client.delete('/player/api/coverage/id?reviewer=forged',headers=self.auth()|{'Origin':'https://example.test'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(self.forwarded[-1].url.params['reviewer'],'reviewer')
    def test_html_urls_are_prefixed_and_reviewer_locked(self):
        r=self.client.get('/player/',headers=self.auth())
        self.assertIn("fetch('/player/api/state')",r.text)
        self.assertIn('gatewayReviewer.readOnly=true',r.text)
        self.assertIn("frame-ancestors 'none'",r.headers['content-security-policy'])
    def test_range_is_streamed_without_auth_header_leak(self):
        r=self.client.get('/player/api/media/a',headers=self.auth()|{'Range':'bytes=2-5'})
        self.assertEqual(r.status_code,206);self.assertEqual(r.content,b'2345')
        self.assertEqual(r.headers['content-range'],'bytes 2-5/10')
        self.assertNotIn('authorization',self.forwarded[-1].headers)
    def test_password_attempts_are_limited(self):
        for _ in range(8):self.client.get('/',headers={'Authorization':'Basic '+base64.b64encode(b'unknown:wrong').decode()})
        self.assertEqual(self.client.get('/').status_code,429)
    def test_admin_exports_and_no_raw_database_route(self):
        self.assertEqual(self.client.get('/player/api/export',headers=self.auth('owner')).status_code,200)
        self.assertEqual(self.client.get('/player/../data/library.db',headers=self.auth('owner')).status_code,403)
    def test_body_limit_and_audit_has_no_secrets(self):
        r=self.client.post('/player/api/events/e',headers=self.auth()|{'Origin':'https://example.test'},content='x'*65537)
        self.assertEqual(r.status_code,413)
        log=(self.config.parent/'access.jsonl').read_text()
        self.assertNotIn('test-reviewer',log);self.assertNotIn('Authorization',log)
    def test_public_http_does_not_challenge_for_cleartext_password(self):
        r=self.client.get('http://example.test/')
        self.assertEqual(r.status_code,426)
        self.assertNotIn('www-authenticate',r.headers)
    def test_unknown_host_rejected(self):
        self.assertEqual(self.client.get('https://unlisted.test/',headers=self.auth()).status_code,400)

    def test_password_rotation_invalidates_cached_login(self):
        self.assertEqual(self.client.get('/',headers=self.auth()).status_code,200)
        self.config_data['users']['reviewer'].update(password_hash('new-test-password'))
        private_write(self.config,self.config_data)
        self.assertEqual(self.client.get('/',headers=self.auth()).status_code,401)
        good={'Authorization':'Basic '+base64.b64encode(b'reviewer:new-test-password').decode()}
        self.assertEqual(self.client.get('/',headers=good).status_code,200)
    def test_local_config_and_logs_are_private(self):
        self.client.get('/',headers=self.auth())
        self.assertEqual(self.config.stat().st_mode & 0o777,0o600)
        self.assertEqual((self.config.parent/'access.jsonl').stat().st_mode & 0o777,0o600)

if __name__=='__main__':unittest.main()
