"""dns_zones: the NS answer read, the DNS host named, one question a day per domain."""
import struct

from msv.collect import dns_zones as z


def _name(*labels: str) -> bytes:
    return b"".join(bytes([len(x)]) + x.encode() for x in labels) + b"\0"


def _answer(*records: bytes) -> bytes:
    question = _name("example", "fr") + struct.pack(">HH", 2, 1)
    return struct.pack(">HHHHHH", 1, 0x8180, 1, len(records), 0, 0) + question + b"".join(records)


def _ns(rdata: bytes, kind: int = 2) -> bytes:
    return b"\xc0\x0c" + struct.pack(">HHIH", kind, 1, 300, len(rdata)) + rdata


def test_reads_plain_and_compressed_names_and_skips_other_records():
    data = _answer(_ns(_name("ns1", "ovh", "net")), _ns(b"\x03dns\xc0\x0c"), _ns(b"\x7f\0\0\1", 1))
    assert z.parse_ns(data) == ["dns.example.fr", "ns1.ovh.net"]


def test_a_looping_name_is_refused():
    data = _answer(_ns(b"\xc0\x1e"))
    data = data[:30] + b"\xc0\x1e" + data[32:]
    try:
        z.parse_ns(data)
    except (ValueError, IndexError, struct.error):
        return
    raise AssertionError("a looping name must not be read")


def test_names_the_host_else_the_domain_of_its_ns():
    assert z.provider(["carl.ns.cloudflare.com"]) == "Cloudflare"
    assert z.provider(["dns200.anycast.me", "ns200.anycast.me"]) == "OVH"
    assert z.provider(["ns1.example.net"]) == "example.net"
    assert z.provider(["ns-12.awsdns-34.org"]) == "AWS Route 53"
    assert z.provider(["ns1.dns-parking.com"]) == "Hostinger"
    assert z.provider(["ns1051.ui-dns.de"]) == "IONOS"
    assert z.provider([]) is None


def test_the_root_of_a_name():
    assert z.root_of("a.b.Example.fr.") == "example.fr"
    assert z.root_of("*.example.fr") == "example.fr"
    assert z.root_of("server") is None


def test_asks_once_a_day_and_leaves_internal_names_out(tmp_path):
    path = str(tmp_path / "zones.json")
    asked = []
    answers = {"example.fr": ["ns.ovh.net"], "krawl.lan": []}

    def ask(server, domain):
        asked.append(domain)
        return answers[domain]

    names = ["a.example.fr", "b.example.fr", "krawl.lan", "server"]
    assert z.zones(["10.0.0.2"], names, path, now=1000, ask=ask) == {"example.fr": "OVH"}
    assert asked == ["example.fr", "krawl.lan"]
    assert z.zones(["10.0.0.2"], names, path, now=2000, ask=ask) == {"example.fr": "OVH"}
    assert len(asked) == 2
    z.zones(["10.0.0.2"], names, path, now=1000 + z.MAX_AGE_S, ask=ask)
    assert len(asked) == 4


def test_no_answer_keeps_what_was_known_and_asks_the_next_server(tmp_path):
    path = str(tmp_path / "zones.json")
    z.zones(["10.0.0.2"], ["example.fr"], path, now=1000, ask=lambda s, d: ["ns.ovh.net"])
    assert z.zones(["10.0.0.2"], ["example.fr"], path, now=1000 + z.MAX_AGE_S, ask=lambda s, d: None) == {"example.fr": "OVH"}
    assert z.zones(["10.0.0.2", "10.0.0.3"], ["example.fr"], path, now=1000 + z.MAX_AGE_S, ask=lambda s, d: None if s == "10.0.0.2" else ["ns.cloudflare.com"]) == {"example.fr": "Cloudflare"}
