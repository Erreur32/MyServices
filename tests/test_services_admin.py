"""Services declared by hand (services_admin.py): add, edit, remove, refusals, try.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import services_admin as sa  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.meta = Path(self.tmp.name) / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {"10.0.0.5": {"name": "srv"}}, "extra": [{"name": "Imprimante", "ip": "10.0.0.50", "port": 80, "scheme": "http"}]}), encoding="utf-8")
        p = mock.patch.object(sa.setup, "META", self.meta)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def extra(self):
        return json.loads(self.meta.read_text(encoding="utf-8"))["extra"]


class Manual(Base):
    def test_list_add_edit_remove(self):
        self.assertEqual([x["name"] for x in sa.list_manual()], ["Imprimante"])
        self.assertEqual(sa.add(" NAS ", "10.0.0.7", "5000", "https"), {"name": "NAS", "ip": "10.0.0.7", "port": 5000, "scheme": "https"})
        self.assertEqual(len(self.extra()), 2)
        self.assertEqual(sa.update("10.0.0.7", 5000, name="NAS web", scheme="tcp", new_port=5001)["port"], 5001)
        self.assertEqual(self.extra()[1], {"name": "NAS web", "ip": "10.0.0.7", "port": 5001, "scheme": "tcp"})
        sa.remove("10.0.0.7", "5001")
        self.assertEqual(len(self.extra()), 1)

    def test_refusals(self):
        for args in (("", "10.0.0.7", 80, "http"), ("x", "not-an-ip", 80, "http"), ("x", "10.0.0.7", 0, "http"), ("x", "10.0.0.7", "abc", "http"), ("x", "10.0.0.7", 80, "ftp"), ("x", "10.0.0.50", 80, "http")):
            with self.assertRaises(sa.ServiceError):
                sa.add(*args)
        with self.assertRaises(sa.ServiceError):
            sa.update("10.0.0.9", 80, name="x")
        with self.assertRaises(sa.ServiceError):
            sa.remove("10.0.0.9", 80)

    def test_try_closed_port_and_tcp_only(self):
        with mock.patch.object(sa.socket, "create_connection", side_effect=OSError("refused")):
            self.assertEqual(sa.try_service("10.0.0.7", 9, "tcp")["up"], False)
        with mock.patch.object(sa.socket, "create_connection") as cc:
            cc.return_value.__enter__ = lambda s: s
            cc.return_value.__exit__ = lambda *a: False
            r = sa.try_service("10.0.0.7", 9, "tcp")
        self.assertTrue(r["up"])
        self.assertIsNone(r["web"])
