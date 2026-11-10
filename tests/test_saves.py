"""Tests for the saved-worlds API. Run with: python3 -m unittest discover tests"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Importing app builds the default app; keep its database out of the project folder.
os.environ.setdefault("LIFESIM_DB", str(Path(tempfile.mkdtemp()) / "unused.db"))

from app import create_app  # noqa: E402


def world(tick=10, seed=42, marker="a"):
    return {"name": "My world", "seed": seed, "tick": tick, "data": {"sim": {"tick": tick, "marker": marker}}}


class SavesApiTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.db_path = Path(self.folder.name) / "nested" / "test.db"
        self.client = create_app(self.db_path).test_client()

    def tearDown(self):
        self.folder.cleanup()

    def test_starts_empty(self):
        self.assertEqual(self.client.get("/api/saves").get_json(), [])
        self.assertEqual(self.client.get("/api/saves/autosave").status_code, 404)

    def test_save_then_load_returns_the_same_world(self):
        saved = self.client.put("/api/saves", json=world()).get_json()
        self.assertEqual((saved["name"], saved["seed"], saved["tick"], saved["autosave"]), ("My world", 42, 10, False))
        loaded = self.client.get(f"/api/saves/{saved['id']}").get_json()
        self.assertEqual(loaded["data"], world()["data"])
        self.assertEqual(loaded["name"], "My world")

    def test_saving_under_the_same_name_overwrites(self):
        first = self.client.put("/api/saves", json=world(tick=10, marker="a")).get_json()
        second = self.client.put("/api/saves", json=world(tick=99, marker="b")).get_json()
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.client.get("/api/saves").get_json()), 1)
        loaded = self.client.get(f"/api/saves/{first['id']}").get_json()
        self.assertEqual((loaded["tick"], loaded["data"]["sim"]["marker"]), (99, "b"))

    def test_autosave_has_its_own_slot_and_is_listed_first(self):
        self.client.put("/api/saves", json=world())
        self.client.put("/api/saves", json={**world(tick=7), "name": "autosave"})
        self.client.put("/api/saves", json={**world(tick=8), "name": "Autosave"})
        listing = self.client.get("/api/saves").get_json()
        self.assertEqual([(s["name"], s["autosave"]) for s in listing], [("Autosave", True), ("My world", False)])
        self.assertNotIn("data", listing[0])
        self.assertEqual(self.client.get("/api/saves/autosave").get_json()["tick"], 8)

    def test_saves_survive_a_restart(self):
        self.client.put("/api/saves", json={**world(), "name": "Autosave"})
        restarted = create_app(self.db_path).test_client()
        self.assertEqual(restarted.get("/api/saves/autosave").get_json()["data"], world()["data"])

    def test_delete(self):
        saved = self.client.put("/api/saves", json=world()).get_json()
        self.assertEqual(self.client.delete(f"/api/saves/{saved['id']}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/saves/{saved['id']}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/saves/{saved['id']}").status_code, 404)

    def test_bad_requests_are_rejected(self):
        bad_bodies = [
            {**world(), "name": ""},
            {**world(), "name": "x" * 61},
            {**world(), "name": 5},
            {**world(), "seed": "42"},
            {**world(), "tick": -1},
            {**world(), "tick": True},
            {**world(), "data": "not an object"},
            ["not", "an", "object"],
        ]
        for body in bad_bodies:
            response = self.client.put("/api/saves", json=body)
            self.assertEqual(response.status_code, 400, body)
            self.assertIn("error", response.get_json())
        self.assertEqual(self.client.put("/api/saves", data="nonsense").status_code, 400)
        self.assertEqual(self.client.get("/api/saves").get_json(), [])

    def test_names_are_stored_safely(self):
        name = "Robert'); DROP TABLE saves;--"
        self.client.put("/api/saves", json={**world(), "name": name})
        self.assertEqual(self.client.get("/api/saves").get_json()[0]["name"], name)

    def test_page_still_loads(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Life sim", response.data)

    def test_charts_window_loads(self):
        response = self.client.get("/charts")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"ui/popout.js", response.data)


if __name__ == "__main__":
    unittest.main()
