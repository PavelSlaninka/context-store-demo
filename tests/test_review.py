"""The user's side: accepting, rejecting and undoing changes (ctx_store.Store and the review CLI)."""

from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEMO / "server"))

import ctx_review  # noqa: E402
from ctx_store import Store, StoreError  # noqa: E402


class ReviewFlow(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ctx-review-test-"))
        for f in (DEMO / "store" / "seed").glob("*.json"):
            shutil.copyfile(f, self.tmp / f.name)
        self.store = Store(self.tmp)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def entry(self, entry_id: str) -> dict:
        return next(e for e in self.store.entries(include_removed=True) if e["id"] == entry_id)

    def test_accept_adds_an_entry_with_provenance_and_history(self) -> None:
        before = len(self.store.entries())
        ev = self.store.accept("p04")
        self.assertEqual(len(self.store.entries()), before + 1)
        new = self.entry(ev["entry_id"])
        self.assertEqual(new["provenance"]["proposed_by"], "assistant-a")
        self.assertEqual(new["provenance"]["basis"], "inferred")
        self.assertEqual(new["provenance"]["approved_by"], "user")
        self.assertEqual(self.store.history()[-1]["id"], ev["id"])

    def test_correction_and_undo(self) -> None:
        old = self.entry("e04")["text"]
        ev = self.store.accept("p05")
        self.assertIn("4 December", self.entry("e04")["text"])
        self.store.undo(ev["id"])
        self.assertEqual(self.entry("e04")["text"], old)
        with self.assertRaises(StoreError):
            self.store.undo(ev["id"])  # already undone

    def test_undo_of_an_addition_removes_the_entry(self) -> None:
        ev = self.store.accept("p04")
        self.store.undo(ev["id"])
        self.assertEqual(self.entry(ev["entry_id"])["status"], "removed")
        self.assertNotIn(ev["entry_id"], {e["id"] for e in self.store.entries()})

    def test_held_back_needs_force_and_blocked_never_passes(self) -> None:
        with self.assertRaises(StoreError):
            self.store.accept("p06")  # held back
        self.store.accept("p06", force=True)  # the person may still release it, knowingly
        for blocked in ("p07", "p08"):  # a rule, and hidden text
            with self.assertRaises(StoreError):
                self.store.accept(blocked, force=True)

    def test_undo_only_the_newest_change_to_an_entry(self) -> None:
        self.store.accept("p05")  # changes e04, which h05 added on 9 Nov
        with self.assertRaises(StoreError):
            self.store.undo("h05")

    def test_undo_everything_one_assistant_proposed(self) -> None:
        old_e03 = self.entry("e03")["text"]
        added = self.store.accept("p04")  # Assistant A, a new preference
        self.store.accept("p10")          # Assistant A, the contact change (the person said yes)
        self.store.accept("p09")          # Assistant B
        done = self.store.undo_connector("assistant-a")
        self.assertEqual(len(done), 3)  # today's two, and e10 from October
        self.assertEqual(self.entry("e03")["text"], old_e03)
        self.assertEqual(self.entry(added["entry_id"])["status"], "removed")
        self.assertEqual(self.entry("e10")["status"], "removed")  # proposed by Assistant A in October
        b_entry = next(e for e in self.store.entries() if e["provenance"].get("proposal_id") == "p09")
        self.assertEqual(b_entry["status"], "active")  # Assistant B's change stays

    def test_undo_one_assistant_since_a_date(self) -> None:
        self.store.accept("p04")
        today = self.store.history()[-1]["at"][:10]
        done = self.store.undo_connector("assistant-a", since=today)
        self.assertEqual(len(done), 1)
        self.assertEqual(self.entry("e10")["status"], "active")  # October's change is kept

    def test_only_the_users_own_why_is_served(self) -> None:
        reader = self.store.connector("assistant-a")

        def served_whys() -> dict[str, str]:
            return {e["id"]: e["why"] for e in self.store.read_for(reader, None, None)["entries"]}

        whys = served_whys()
        self.assertEqual(whys["e04"], "I plan my weeks around it.")  # the user wrote it
        self.assertEqual(whys["e10"], "")  # Assistant A's explanation stays on the user's card
        added = self.store.accept("p04")
        self.assertEqual(self.entry(added["entry_id"])["why"], "Asked for logistics examples in four of the last six chats.")
        self.assertEqual(served_whys()[added["entry_id"]], "")
        changed = self.store.accept("p05")  # Assistant B's change to the user's entry brings its own why
        self.assertIn("18 November", self.entry("e04")["why"])
        self.assertEqual(served_whys()["e04"], "")
        self.store.undo(changed["id"])
        self.assertEqual(served_whys()["e04"], "I plan my weeks around it.")

    def test_reject_changes_nothing(self) -> None:
        entries = (self.tmp / "entries.json").read_bytes()
        self.store.reject("p06")
        self.assertEqual((self.tmp / "entries.json").read_bytes(), entries)
        status = {p["id"]: p["status"] for p in self.store.proposals()}
        self.assertEqual(status["p06"], "rejected")

    def test_cli_list_and_accept(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(ctx_review.main(["--store", str(self.tmp), "list"]), 0)
        self.assertIn("5 proposal(s) waiting for you", out.getvalue())
        self.assertIn("HELD BACK", out.getvalue())
        self.assertIn("2 blocked attempt(s)", out.getvalue())
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(ctx_review.main(["--store", str(self.tmp), "accept", "p04"]), 0)
            self.assertEqual(ctx_review.main(["--store", str(self.tmp), "accept", "p06"]), 1)
        history = json.loads((self.tmp / "history.json").read_text())["history"]
        self.assertEqual(history[-1]["proposal_id"], "p04")


if __name__ == "__main__":
    unittest.main()
