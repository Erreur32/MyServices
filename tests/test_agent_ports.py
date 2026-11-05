"""Ports Windows/Linux rapportés par un agent et devenus services (brave, HASS.Agent) : réglage « agent_ports » / « agent_ignore »
de la machine (machines_admin), et l'état montré quand le port est confirmé par l'agent mais injoignable par la collecte
(myservices.agent_unreachable_backend) : « filtré » plutôt qu'une fausse panne, abandonné sauf en mode « all ».

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import config  # noqa: E402
from msv.machines import machines_admin  # noqa: E402

with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    from msv.collect import myservices  # noqa: E402


class AgentPortsSetting(unittest.TestCase):
    def test_valid_modes_kept(self):
        for mode in ("all", "reachable", "none"):
            self.assertEqual(machines_admin._clean({"name": "PC", "agent_ports": mode})["agent_ports"], mode)

    def test_unknown_mode_refused(self):
        with self.assertRaises(machines_admin.MachineError):
            machines_admin._clean({"name": "PC", "agent_ports": "sometimes"})

    def test_ignore_list_deduplicated_and_trimmed(self):
        out = machines_admin._clean({"name": "PC", "agent_ignore": [" brave ", "Discord", "brave"]})
        self.assertEqual(out["agent_ignore"], ["brave", "Discord"])

    def test_ignore_list_bad_name_refused(self):
        with self.assertRaises(machines_admin.MachineError):
            machines_admin._clean({"name": "PC", "agent_ignore": ["brave; rm -rf"]})


class KeptPorts(unittest.TestCase):
    def test_port_left_out_is_kept_and_marked(self):
        got = myservices.with_kept_ports({135: {"name": "svchost", "lan": True}}, {445: "System", 135: "old"})
        self.assertEqual(got[445], {"name": "System", "lan": True, "kept": True})
        self.assertEqual(got[135], {"name": "svchost", "lan": True})   # the report wins over the memory

    def test_nothing_seen_before(self):
        self.assertEqual(myservices.with_kept_ports({}, {}), {})


class WebcheckMessage(unittest.TestCase):
    def test_nothing_due(self):
        self.assertEqual(myservices.webcheck_message(92, 92, 0), "92/92 sites à jour, aucun à recontrôler à ce passage")

    def test_plural(self):
        self.assertEqual(myservices.webcheck_message(90, 92, 1), "90/92 sites à jour, 1 contrôlé à ce passage")
        self.assertEqual(myservices.webcheck_message(90, 92, 3), "90/92 sites à jour, 3 contrôlés à ce passage")


class AgentUnreachableBackend(unittest.TestCase):
    def test_reachable_mode_is_hidden(self):
        backend, drop = myservices.agent_unreachable_backend("reachable")
        self.assertEqual(backend, {"up": True, "via": "agent", "filtered": True})
        self.assertTrue(drop)

    def test_all_mode_is_kept(self):
        _, drop = myservices.agent_unreachable_backend("all")
        self.assertFalse(drop)


if __name__ == "__main__":
    unittest.main()
