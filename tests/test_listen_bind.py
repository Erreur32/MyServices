"""Listen address of a port (ss -tlnp, agent report): a process bound to a bridge or container address (172.30.0.3:8443, an
Apache behind Anubis) is « internal », the collector cannot probe it through the machine's IP.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import process  # noqa: E402

try:
    import agents
except ImportError:
    agents = None

SS = ('LISTEN 0 511 172.30.0.3:8443 0.0.0.0:* users:(("apache2",pid=1363753,fd=4),("apache2",pid=1108611,fd=4))\n'
      'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=6))\n'
      'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=2,fd=6))\n'
      'LISTEN 0 128 [::]:5432 [::]:* users:(("postgres",pid=2,fd=7))\n'
      'LISTEN 0 128 [::1]:6379 [::]:* users:(("redis",pid=3,fd=6))\n')


class ListenAddress(unittest.TestCase):
    def test_each_port_keeps_its_listen_address(self):
        ports, _ = process.parse_listening(SS)
        self.assertEqual(ports[8443], {"name": "apache2", "lan": True, "addr": "172.30.0.3"})
        self.assertEqual(ports[80]["addr"], "0.0.0.0")
        self.assertEqual((ports[6379]["lan"], ports[6379]["addr"]), (False, "[::1]"))

    def test_the_widest_address_wins_when_a_port_is_bound_twice(self):
        ports, _ = process.parse_listening(SS)
        self.assertEqual((ports[5432]["lan"], ports[5432]["addr"]), (True, "[::]"))   # loopback first, then every interface

    def test_internal_bind(self):
        ip = "10.0.0.150"
        self.assertTrue(process.internal_bind("172.30.0.3", ip))
        self.assertTrue(process.internal_bind("[fd00::3]", ip))
        for addr in ("0.0.0.0", "*", "[::]", "::", ip, f"[::ffff:{ip}]", "127.0.0.1", "[::1]", None, ""):
            self.assertFalse(process.internal_bind(addr, ip), addr)


@unittest.skipIf(agents is None, "agents.py needs its dependencies (run in the image)")
class AgentPorts(unittest.TestCase):
    def test_agent_ports_carry_the_address(self):
        report = {"data": {"ports": [{"p": 8443, "a": "172.30.0.3", "n": "apache2"}, {"p": 80, "a": "127.0.0.1", "n": "nginx"},
                                     {"p": 80, "a": "0.0.0.0", "n": "nginx"}]}}
        got = agents.ports_of(report)
        self.assertEqual(got[8443], {"name": "apache2", "lan": True, "addr": "172.30.0.3"})
        self.assertEqual(got[80], {"name": "nginx", "lan": True, "addr": "0.0.0.0"})


if __name__ == "__main__":
    unittest.main()
