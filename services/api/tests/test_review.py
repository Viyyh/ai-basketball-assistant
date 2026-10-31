import tempfile
import unittest
from fastapi.testclient import TestClient
from app.main import create_app

class ReviewTest(unittest.TestCase):
    def test_confirm_recompute_and_revoke(self):
        with tempfile.TemporaryDirectory() as directory:
            client = TestClient(create_app(directory + '/review.db'))
            url = '/v1/review/games/nba-game1/shots'
            response = client.post(url, json={'seconds': 4, 'team': 'home', 'points': 3, 'made': True})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(client.get(url).json()['stats']['home'], {'attempts': 1, 'made': 1, 'points': 3})
            self.assertEqual(client.delete(url + '/' + str(response.json()['id'])).status_code, 204)
            self.assertEqual(client.get(url).json()['stats']['home']['attempts'], 0)
            self.assertEqual(client.post(url, json={'seconds': -1, 'team': 'home', 'points': 3, 'made': True}).status_code, 422)
