"""connectors/swisscom_box.py: the thin Livebox-protocol connector, against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_swisscom_box
"""
import unittest

from connectors.base import ConnectorError
from connectors.swisscom_box import SwisscomBox
from tests.test_livebox import BASE, FIBRE, PASSWORD, PUBLIC_IP, FakeContext


def conf(**kw):
    return {"type": "swisscom-box", "name": "box", "url": BASE, "username": "admin", "password": PASSWORD, **kw}


class SwisscomBoxTest(unittest.TestCase):
    def test_reading(self):
        d = SwisscomBox(conf(), FakeContext(FIBRE)).collect()
        self.assertEqual((d["box"]["line"], d["box"]["connected"], d["box"]["public_ip"]), ("fibre", True, PUBLIC_IP))
        self.assertNotIn(PASSWORD, str(d))

    def test_secret_field(self):
        self.assertTrue(next(f for f in SwisscomBox.fields if f.name == "password").secret)

    def test_refused_login_is_one_call_and_names_the_box(self):
        ctx = FakeContext(FIBRE, "HTTP 401")
        with self.assertRaises(ConnectorError) as e:
            SwisscomBox(conf(), ctx).collect()
        self.assertEqual(len(ctx.calls), 1)
        self.assertIn("Internet-Box", str(e.exception))
        self.assertNotIn("Livebox", str(e.exception))
        self.assertNotIn(PASSWORD, str(e.exception))


if __name__ == "__main__":
    unittest.main()
