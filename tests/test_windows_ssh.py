"""Windows read over SSH (health.collect_windows): the long script goes through stdin behind a short loader (cmd.exe, the default OpenSSH
shell of Windows, refuses a command line over 8191 characters), and the Windows Update titles are reused for an hour, as the agent does.

  python3 -m unittest tests.test_windows_ssh
"""
import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import health  # noqa: E402

HOST = {"id": "pc", "name": "PC", "mode": "ssh", "target": "pc", "os": "windows"}
ANSWER = {"disks": [{"m": "C:", "s": 500e9, "f": 250e9}], "svc": [], "cpu": 5, "ncpu": 8, "mem": 30, "boot": "2026-10-20T08:00:00Z",
          "reboot": False, "ev": [], "fail": 0, "upd": ["Mise à jour cumulative d'octobre"]}


class Loader(unittest.TestCase):
    def test_amorce_courte_qui_lit_l_entree(self):
        self.assertLess(len(health.PS_STDIN), 8191)
        self.assertGreater(len(health.ps_command(health.WIN_PS)), 8191)   # why the script no longer goes on the command line
        loader = base64.b64decode(health.PS_STDIN.split()[-1]).decode("utf-16-le")
        self.assertIn("[Console]::In.ReadToEnd()", loader)
        self.assertIn("FromBase64String", loader)

    def test_script_en_base64_utf8(self):
        script = "Write-Output 'été'"
        self.assertEqual(base64.b64decode(health.ps_stdin(script)).decode("utf-8"), script)
        self.assertTrue(health.ps_stdin(script).isascii())

    def test_titres_reinjectes_avec_apostrophes(self):
        self.assertEqual(health.win_script(None), health.WIN_PS)
        head = health.win_script(["Mise à jour d'octobre"]).splitlines()[0]
        self.assertEqual(head, "$env:MSV_UPD='[\"Mise à jour d''octobre\"]'")   # a quote doubled inside a PowerShell single-quoted string

    def test_script_allege(self):
        self.assertEqual(health.WIN_PS.count("Get-CimInstance Win32_Service"), 1)   # one query for stopped and running services
        self.assertIn("Id=4625;StartTime=$t} -MaxEvents 1000", health.WIN_PS)      # failed logons: counted up to 1000, never all of them
        self.assertIn("$slow=-not $env:MSV_SKIP", health.WIN_PS)


class CollectWindows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = mock.patch.object(health, "WIN_UPD_CACHE", str(Path(self.tmp.name) / "windows-updates.json"))
        self.cache.start()
        self.sent = []

    def tearDown(self):
        self.cache.stop()
        self.tmp.cleanup()

    def runner(self, rc=0, out=json.dumps(ANSWER)):
        def run(cmd, timeout=15, data=None):
            self.sent.append((cmd, base64.b64decode(data).decode("utf-8") if data else None))
            return rc, out
        return run

    def test_par_l_entree_puis_titres_en_cache(self):
        with mock.patch.object(health, "make_runner", return_value=self.runner()):
            first = health.collect_windows(HOST)
            second = health.collect_windows(HOST)
        self.assertTrue(first["reachable"] and second["reachable"])
        (cmd1, script1), (cmd2, script2) = self.sent
        self.assertEqual((cmd1, cmd2), (health.PS_STDIN, health.PS_STDIN))
        self.assertEqual(script1, health.WIN_PS)                       # first read: the Windows Update search runs
        self.assertTrue(script2.startswith("$env:MSV_UPD='[\"Mise à jour cumulative d''octobre\"]'\n"))   # then its titles are reused
        self.assertTrue(script2.endswith(health.WIN_PS))

    def test_titres_trop_vieux_ou_machine_muette(self):
        with mock.patch.object(health, "make_runner", return_value=self.runner()):
            health.collect_windows(HOST)
        with mock.patch.object(health.time, "time", return_value=10 ** 10):
            self.assertIsNone(health._win_upd_cached("pc"))
        with mock.patch.object(health, "make_runner", return_value=self.runner(255, "Connection refused")):
            h = health.collect_windows({**HOST, "target": "autre"})
        self.assertEqual((h["reachable"], h["level"]), (False, "down"))
        self.assertIsNone(health._win_upd_cached("autre"))

    def test_cache_illisible(self):
        Path(health.WIN_UPD_CACHE).write_text("pas du json", encoding="utf-8")
        self.assertIsNone(health._win_upd_cached("pc"))
        health._win_upd_store("pc", ["KB1"])
        self.assertEqual(health._win_upd_cached("pc"), ["KB1"])


if __name__ == "__main__":
    unittest.main()
