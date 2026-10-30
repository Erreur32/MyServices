"""The box connectors are registered, in their category, and none asks for more than the secrets it keeps in the store.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import unittest

import connectors
from connectors.settings import category

BOXES = {"sfrbox": (), "livebox": ("password",), "vodafone-station": ("password",), "sagemcom-fast": ("password",), "bbox": ("password",),
         "swisscom-box": ("password",), "connect-box": ("password",), "speedport": ("password",), "technicolor-gateway": ("password",),
         "tmobile-home-internet": ("password",), "hitron-coda": ("password",), "verizon-fios": ("password",), "arris-surfboard": ("password",)}


class Registration(unittest.TestCase):
    def test_each_box_is_registered_in_network(self):
        for kind, secrets in BOXES.items():
            with self.subTest(kind):
                cls = connectors.TYPES[kind]
                self.assertEqual(category(kind), "Réseau / DNS")
                self.assertEqual(tuple(f.name for f in cls.fields if f.secret), secrets)


if __name__ == "__main__":
    unittest.main()
