"""dns_zones: the NS answer read, the DNS host named, one question a day per domain."""
import os
import struct
import tempfile
import unittest
from unittest import mock

from msv.collect import dns_zones as z


def _name(*labels: str) -> bytes:
    return b"".join(bytes([len(x)]) + x.encode() for x in labels) + b"\0"


def _answer(*records: bytes) -> bytes:
    question = _name("example", "fr") + struct.pack(">HH", 2, 1)
    return struct.pack(">HHHHHH", 1, 0x8180, 1, len(records), 0, 0) + question + b"".join(records)


def _ns(rdata: bytes, kind: int = 2) -> bytes:
    return b"\xc0\x0c" + struct.pack(">HHIH", kind, 1, 300, len(rdata)) + rdata


class ReadNs(unittest.TestCase):
    def test_reads_plain_and_compressed_names_and_skips_other_records(self):
        data = _answer(_ns(_name("ns1", "ovh", "net")), _ns(b"\x03dns\xc0\x0c"), _ns(b"\x7f\0\0\1", 1))
        self.assertEqual(z.parse_ns(data), ["dns.example.fr", "ns1.ovh.net"])

    def test_a_looping_name_is_refused(self):
        data = _answer(_ns(b"\xc0\x28"))   # the name of the record sits at byte 40 and points at itself
        with self.assertRaisesRegex(ValueError, "looping"):
            z.parse_ns(data)

    def test_names_the_host_else_the_domain_of_its_ns(self):
        self.assertEqual(z.provider(["carl.ns.cloudflare.com"]), "Cloudflare")
        self.assertEqual(z.provider(["dns200.anycast.me", "ns200.anycast.me"]), "OVH")
        self.assertEqual(z.provider(["ns1.example.net"]), "example.net")
        self.assertEqual(z.provider(["ns-12.awsdns-34.org"]), "AWS Route 53")
        self.assertEqual(z.provider(["ns1.dns-parking.com"]), "Hostinger")
        self.assertEqual(z.provider(["ns1051.ui-dns.de"]), "IONOS")
        self.assertIsNone(z.provider([]))

    def test_the_root_of_a_name(self):
        self.assertEqual(z.root_of("a.b.Example.fr."), "example.fr")
        self.assertEqual(z.root_of("*.example.fr"), "example.fr")
        self.assertIsNone(z.root_of("server"))

    def test_a_server_that_does_not_answer_gives_nothing(self):
        with mock.patch.object(z.socket, "socket", side_effect=OSError("no route")):
            self.assertIsNone(z.ask_ns("10.0.0.2", "example.fr"))


class AskOnceADay(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = os.path.join(folder.name, "zones.json")

    def test_asks_once_a_day_and_leaves_internal_names_out(self):
        asked = []
        answers = {"example.fr": ["ns.ovh.net"], "krawl.lan": []}

        def ask(server, domain):
            asked.append(domain)
            return answers[domain]

        names = ["a.example.fr", "b.example.fr", "krawl.lan", "server"]
        self.assertEqual(z.zones(["10.0.0.2"], names, self.path, now=1000, ask=ask), {"example.fr": "OVH"})
        self.assertEqual(asked, ["example.fr", "krawl.lan"])
        self.assertEqual(z.zones(["10.0.0.2"], names, self.path, now=2000, ask=ask), {"example.fr": "OVH"})
        self.assertEqual(len(asked), 2)
        z.zones(["10.0.0.2"], names, self.path, now=1000 + z.MAX_AGE_S, ask=ask)
        self.assertEqual(len(asked), 4)

    def test_no_answer_keeps_what_was_known_and_asks_the_next_server(self):
        z.zones(["10.0.0.2"], ["example.fr"], self.path, now=1000, ask=lambda s, d: ["ns.ovh.net"])
        later = 1000 + z.MAX_AGE_S
        self.assertEqual(z.zones(["10.0.0.2"], ["example.fr"], self.path, now=later, ask=lambda s, d: None), {"example.fr": "OVH"})
        got = z.zones(["10.0.0.2", "10.0.0.3"], ["example.fr"], self.path, now=later, ask=lambda s, d: None if s == "10.0.0.2" else ["ns.cloudflare.com"])
        self.assertEqual(got, {"example.fr": "Cloudflare"})

    def test_a_broken_cache_is_ignored(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("not json")
        self.assertEqual(z.zones(["10.0.0.2"], ["example.fr"], self.path, now=1000, ask=lambda s, d: ["ns.ovh.net"]), {"example.fr": "OVH"})


if __name__ == "__main__":
    unittest.main()
