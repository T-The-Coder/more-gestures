"""bin/setup-hypr on a throwaway config: adds its block once, detects a hand-made hook,
removes only its own block, keeps backups."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "bin" / "setup-hypr"


class SetupHyprTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.hypr = Path(self.tmp.name) / "hypr"
        self.hypr.mkdir()
        self.input = self.hypr / "input.lua"
        self.input.write_text("-- user input\nhl.config({})\n")
        self.env = dict(os.environ, XDG_CONFIG_HOME=self.tmp.name, MORE_GESTURES_NO_RELOAD="1")

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args):
        return subprocess.run([str(SCRIPT), *args], env=self.env, capture_output=True, text=True)

    def test_adds_once_and_removes_only_its_block(self):
        self.assertEqual(self.run_script("--check").returncode, 1)
        self.assertEqual(self.run_script().returncode, 0)
        text = self.input.read_text()
        self.assertIn("-- >>> more-gestures", text)
        self.assertIn('dofile(more_gestures)', text)
        self.assertTrue(text.startswith("-- user input\nhl.config({})\n"))
        self.assertEqual(self.run_script("--check").returncode, 0)
        # Second run: nothing added twice.
        self.run_script()
        self.assertEqual(self.input.read_text().count("-- >>> more-gestures"), 1)
        self.assertTrue(list(self.hypr.glob("input.lua.bak.more-gestures-*")))
        self.assertEqual(self.run_script("--remove").returncode, 0)
        self.assertEqual(self.input.read_text().rstrip("\n"), "-- user input\nhl.config({})")
        self.assertEqual(self.run_script("--check").returncode, 1)

    def test_hand_made_hook_counts_and_stays(self):
        hand = "-- user input\ndofile(home .. '/.local/state/omarchy/settings/more-gestures-hypr.lua')\n"
        self.input.write_text(hand)
        self.assertEqual(self.run_script("--check").returncode, 0)
        self.run_script()
        self.assertEqual(self.input.read_text(), hand)
        self.run_script("--remove")
        self.assertEqual(self.input.read_text(), hand)


if __name__ == "__main__":
    unittest.main()
