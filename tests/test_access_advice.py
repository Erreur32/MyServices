"""Recommandation de la méthode de lecture (SSH, agent, connecteur, ping) : une machine par cas de référence."""
import unittest

import access_advice as adv


def machine(**kw):
    return {"ip": "192.168.1.10", "name": "m", "ping": True, "ttl": 64, "detected": [], **kw}


class Advice(unittest.TestCase):
    def check(self, f, method, why, agent_possible, agent_kind=None, current=None):
        a = adv.advise(f)
        self.assertEqual((a["method"], a["why"], a["agent_possible"], a["agent_kind"]), (method, why, agent_possible, agent_kind), a)
        if current is not None:
            self.assertEqual(a["current"], current)
        self.assertNotIn(a["method"], a["alternatives"])
        return a

    def test_linux_read_by_ssh(self):
        m = machine(info={"os": "Debian GNU/Linux 13"}, ssh={"alias": "srv", "port": 22})
        a = self.check(adv.facts_of(m), "agent", "agent_linux_ssh", True, "linux", ["ssh"])
        self.assertEqual(a["alternatives"], ["ssh"])

    def test_vps_with_unusual_ssh_port(self):
        m = machine(info={"os": "Debian GNU/Linux 12"}, ssh={"alias": "vps", "port": 22232}, ttl=52)
        self.check(adv.facts_of(m), "agent", "agent_linux_ssh", True, "linux", ["ssh"])

    def test_linux_with_ssh_port_seen_by_the_scan_only(self):
        self.check(adv.facts_of(machine(), scan={"os": "linux", "ssh_port": 22}), "agent", "agent_linux", True, "linux", [])

    def test_windows_pc_with_agent(self):
        m = machine(ttl=128, agent={"via": "agent", "os": "Windows 11"})
        a = self.check(adv.facts_of(m, {"os": "windows"}), "agent", "windows", True, "windows", ["agent"])
        self.assertEqual(a["kind"], "windows")

    def test_windows_guessed_from_ttl_gets_the_windows_agent(self):
        self.check(adv.facts_of(machine(ttl=128)), "agent", "windows", True, "windows", [])

    def test_box_is_read_by_its_connector_never_by_an_agent(self):
        m = machine(ip="192.168.1.254", icon="freebox", ttl=63, api=[], links={"sources": [{"label": "NetTool", "ok": True}]})
        self.check(adv.facts_of(m), "connector", "appliance", False, None, ["connector"])

    def test_freebox_is_matched_to_its_network_tool_by_name(self):
        net = [{"label": "NetTool", "freebox": {"system": {"model": "x"}}}]
        m = machine(name="Freebox", icon="freebox")
        self.check(adv.facts_of(m, network=net), "connector", "appliance", False, None, ["connector"])
        self.assertEqual(adv.facts_of(machine(name="Freebox Player"), network=net)["connectors"], [])   # the Player is another device
        self.assertEqual(adv.facts_of(machine(name="Other"), network=net)["connectors"], [])

    def test_box_without_connector_is_ping_only(self):
        self.check(adv.facts_of(machine(icon="freebox")), "ping", "appliance", False)

    def test_gateway_with_open_ssh_port_is_still_an_appliance(self):
        m = machine(role="passerelle UniFi · DHCP / firewall", links={"sources": [{"label": "NetTool", "ok": True}]})
        self.check(adv.facts_of(m, scan={"os": "linux", "ssh_port": 22, "apps": ["UniFi"]}), "connector", "appliance", False)

    def test_home_assistant_os_is_read_by_its_api_not_by_ssh_or_agent(self):
        m = machine(ssh={"alias": "ha"}, api=[{"label": "Home Assistant", "ok": True}])   # SSH set up but not readable (erased at each reboot)
        self.check(adv.facts_of(m), "connector", "home_assistant", False, None, ["connector"])
        m = machine(info={"os": "Home Assistant OS 14"}, ssh={"alias": "ha"}, api=[{"label": "Home Assistant", "ok": True}])   # even with a working SSH add-on
        self.check(adv.facts_of(m), "connector", "home_assistant", False, None, ["ssh", "connector"])
        self.check(adv.facts_of(machine(), scan={"os": "linux", "apps": ["Home Assistant"]}), "ping", "home_assistant", False)

    def test_home_assistant_in_a_container_on_a_normal_linux_is_a_normal_linux(self):
        m = machine(info={"os": "Debian GNU/Linux 12"}, ssh={"alias": "srv"}, api=[{"label": "Home Assistant", "ok": True}])
        a = self.check(adv.facts_of(m), "agent", "agent_linux_ssh", True, "linux", ["ssh", "connector"])
        self.assertEqual(a["alternatives"], ["ssh", "connector"])

    def test_hypervisor_with_ssh(self):
        m = machine(info={"os": "Debian GNU/Linux 12"}, ssh={"alias": "pve"}, api=[{"label": "Hypervisor", "ok": True}])
        self.check(adv.facts_of(m), "agent", "agent_linux_ssh", True, "linux", ["ssh", "connector"])

    def test_linux_without_ssh_gets_the_linux_agent(self):
        self.check(adv.facts_of(machine(), scan={"os": "linux", "ssh_port": None}), "agent", "no_ssh_port", True, "linux", [])

    def test_unknown_system_stays_ping_only_and_leaves_the_choice(self):
        a = self.check(adv.facts_of(machine(ttl=None)), "ping", "unknown_system", True, None)
        self.assertEqual(a["alternatives"], ["agent"])

    def test_unreachable_machine(self):
        self.check(adv.facts_of(machine(ping=False, ttl=None), scan={"os": "linux"}), "ping", "unreachable", True, "linux")

    def test_connector_only_machine(self):
        m = machine(api=[{"label": "App", "ok": True}])
        self.check(adv.facts_of(m, scan={"os": "linux"}), "connector", "connector_only", True, "linux", ["connector"])

    def test_macos_has_no_agent(self):
        m = machine(info={"os": "macOS 14"}, ssh={"alias": "mac"})
        self.check(adv.facts_of(m), "ssh", "macos", False, None, ["ssh"])
        self.check(adv.facts_of(machine(), scan={"os": "macos"}), "ping", "macos_no_ssh", False)

    def test_phone_or_network_device(self):
        self.check(adv.facts_of(machine(), scan={"os": "ios"}), "ping", "device", False)

    def test_stale_connector_still_counts_as_linked(self):
        f = adv.facts_of(machine(api=[{"label": "App", "ok": False, "stale": True}]))
        self.assertEqual(f["connectors"], ["App"])

    def test_failed_connector_is_not_a_source(self):
        f = adv.facts_of(machine(links={"sources": [{"label": "Down", "ok": False}]}))
        self.assertEqual(f["connectors"], [])

    def test_silent_agent_is_reported_so_the_page_can_say_it(self):
        # Windows PC: the agent is installed but silent (its reports go elsewhere or the PC is off); a connector reads it meanwhile
        m = machine(ttl=128, api=[{"label": "Tool", "ok": True}])
        a = adv.advise(adv.facts_of(m, {"os": "windows"}, agent_state="silencieux"))
        self.assertEqual((a["method"], a["agent_state"], a["current"]), ("agent", "silencieux", ["connector"]))
        self.assertIsNone(adv.advise(adv.facts_of(m, {"os": "windows"}))["agent_state"])   # no agent installed

    def test_all_machines(self):
        ms = [machine(ip="192.168.1.1", icon="freebox"), machine(ip="192.168.1.2", info={"os": "Debian"}, ssh={"alias": "a"}), {"name": "no ip"}]
        out = adv.advise_all(ms, agents={"192.168.1.2": "silencieux"})
        self.assertEqual({k: v["method"] for k, v in out.items()}, {"192.168.1.1": "ping", "192.168.1.2": "agent"})
        self.assertEqual({k: v["agent_state"] for k, v in out.items()}, {"192.168.1.1": None, "192.168.1.2": "silencieux"})



class SshUses(unittest.TestCase):
    def test_what_needs_ssh_beyond_the_agent(self):
        machines = {"10.0.0.2": {"name": "srv", "ssh": "srv"}, "10.0.0.3": {"name": "pve", "ssh": "pve"}, "10.0.0.4": {"name": "plain", "ssh": "plain"},
                    "10.0.0.5": {"name": "dns", "ssh": "dns", "adguard": "docker"}, "10.0.0.6": {"name": "old", "ssh": "old", "disabled": True}}
        conns = [{"type": "npm", "name": "npm", "ssh": "srv"}, {"type": "docker", "name": "x", "ssh": "plain"}, {"type": "borgmatic", "name": "b", "ssh": "old"}]
        hosts = [{"id": "srv", "ssh": "srv"}, {"id": "nas", "ssh": "plain", "mount": "/mnt/nas"}, {"id": "vm", "ssh": None, "cron_via": "pve:101"}]
        virt = [{"connector": "proxmox", "ip": "10.0.0.3", "via": "ssh"}, {"connector": "proxmox", "ip": "10.0.0.4", "via": "api"}]
        self.assertEqual(adv.ssh_uses(machines, conns, hosts, virt),
                         {"10.0.0.2": ["backups", "npm"], "10.0.0.3": ["backups", "proxmox"], "10.0.0.5": ["adguard"]})


if __name__ == "__main__":
    unittest.main()
