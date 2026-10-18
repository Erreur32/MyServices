"""Linux agent, server side: a report carries the outputs of the commands the SSH collection runs, and the server replays them
through the same collectors (health.collect_linux). Nothing sent by an agent is ever executed here.

  python3 -m unittest tests.test_agents_linux
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import agents  # noqa: E402
import health  # noqa: E402

HOST = {"id": "box", "name": "Box", "mode": "ssh", "target": "box", "vm": False}
DF = ("/dev/sda1 100000 91000 9000 91% /\n/dev/sdb1 500000 100000 400000 20% /data\ntmpfs 800 0 800 0% /run\n---\n"
      "/dev/sda1 600000 50000 550000 9% /\n/dev/sdb1 900000 10000 890000 2% /data\n")
STAT1 = "cpu  100 0 100 800 0 0 0 0 0 0"
STAT2 = "cpu  150 0 150 1100 0 0 0 0 0 0"
MEM = "MemTotal: 16384000 kB\nMemAvailable: 8192000 kB\nSwapTotal: 2048000 kB\nSwapFree: 2048000 kB"
OUTPUTS = {
    health.DISKS_CMD: (0, DF),
    health.SYSTEMD_CMD: (0, "nginx.service loaded failed failed A high performance web server\n"),
    health.DOCKER_PS_CMD: (0, "web|Up 2 days|nginx:latest\ndb|Exited (1) 3 hours ago|postgres:16\n"),
    health.DOCKER_STATS_CMD: (0, "web|1.50%|40MiB / 8GiB|0.50%\n"),
    health.APT_CMD: (0, "Listing...\ncurl/stable 8.0 amd64 [upgradable from: 7.9]\n"),
    health.KERNEL_CMD: (0, ""),
    health.REBOOT_CMD: (0, "yes\n"),
    health.LOAD_CMD: (0, "0.50 0.40 0.30 1/200 123\n4\n"),
    health._RES_CMD: (0, f"{STAT1}\n{STAT2}\n{MEM}\n"),
    health._TEMP_CMD: (1, ""),
    health.VIRT_CMD: (0, "kvm\n"),
    health.SSH_AUTH_CMD: (0, "7\n"),
    health.SMART_LIST_CMD: (0, "sda\nnvme0n1\n"),
    health.LOGS_CMD: (0, "3145728000 /var/log/big.log\n---\nArchived and active journals take up 1.5G in the file system.\n"),
    health.smart_cmd("sda"): (0, "SMART overall-health self-assessment test result: PASSED\n"),
    health.smart_cmd("nvme0"): (0, "SMART overall-health self-assessment test result: PASSED\n"),
}


def direct_runner(asked: list):
    def run(cmd, timeout=15):
        asked.append(cmd)
        return OUTPUTS.get(cmd, (127, "inconnu"))
    return run


class LinuxAgent(unittest.TestCase):
    def test_rejeu_identique_a_la_lecture_directe(self):
        asked: list = []
        direct = health.collect_linux(HOST, direct_runner(asked))
        # the agent records the fixed commands, plus one smart command per disk it finds: nothing else may be needed
        recorded = {c: list(OUTPUTS[c]) for c in health.LINUX_AGENT_COMMANDS}
        recorded.update({health.smart_cmd(t): list(OUTPUTS[health.smart_cmd(t)]) for t in ("sda", "nvme0")})
        missing = set(asked) - set(recorded)
        self.assertEqual(missing, set(), "a collector runs a command the agent does not record")
        replayed = health.collect_linux(HOST, health.replay_runner(recorded))
        self.assertEqual(replayed, direct)
        self.assertTrue(direct["reboot_required"])
        self.assertEqual(direct["ssh_auth"]["failed_24h"], 7)
        self.assertEqual([d["mount"] for d in direct["disks"]], ["/", "/data"])
        self.assertTrue(direct["smart"]["accessible"])

    def test_commande_non_relevee_echoue_comme_un_outil_absent(self):
        run = health.replay_runner({health.REBOOT_CMD: [0, "no\n"]})
        self.assertEqual(run(health.REBOOT_CMD), (0, "no\n"))
        self.assertEqual(run("rm -rf /")[0], 127)                       # an unknown command is never run, only looked up
        h = health.collect_linux(HOST, health.replay_runner({}))
        self.assertFalse(h["docker"]["accessible"])
        self.assertEqual(h["disks"], [])
        self.assertEqual(health.replay_runner(None)("x")[0], 127)       # junk in place of the table

    def test_validation_du_releve(self):
        ok = {"version": "1", "os": "Debian", "host": "box", "data": {"kind": "linux", "cmds": {health.REBOOT_CMD: [0, "no\n"]}}}
        self.assertIs(agents.validate_report(ok), ok)
        for bad in ({"kind": "linux"}, {"kind": "linux", "cmds": {}}, {"kind": "linux", "cmds": []},
                    {"kind": "linux", "cmds": {"a": "pas une liste"}}, {"kind": "linux", "cmds": {"a": [0]}},
                    {"kind": "linux", "cmds": {"a": ["0", "x"]}}, {"kind": "linux", "cmds": {"a": [True, "x"]}},
                    {"kind": "linux", "cmds": {"a": [0, 5]}}, {"kind": "linux", "cmds": {1: [0, "x"]}},
                    {"kind": "linux", "cmds": {"a": [0, "x" * (agents.MAX_LINUX_OUT + 1)]}},
                    {"kind": "linux", "cmds": {"c" * 1001: [0, "x"]}},
                    {"kind": "linux", "cmds": {f"c{i}": [0, "x"] for i in range(agents.MAX_LINUX_CMDS + 1)}}):
            with self.assertRaises(agents.AgentError, msg=str(bad)[:60]):
                agents.validate_report({"data": bad})

    def test_releve_windows_inchange(self):
        win = {"data": {"disks": [{"m": "C:", "s": 500e9, "f": 150e9}], "svc": [], "cpu": 1, "ncpu": 2, "mem": 3.0,
                        "boot": "2026-10-10T08:00:00.0000000Z", "reboot": False, "pd": [], "ev": [], "fail": 0, "upd": []}}
        self.assertIs(agents.validate_report(win), win)

    def test_niveau_et_lecture_d_un_releve_frais(self):
        report = {"data": {"kind": "linux", "cmds": {c: list(OUTPUTS[c]) for c in health.LINUX_AGENT_COMMANDS}}}
        self.assertIn(agents.report_level(report), ("ok", "warn", "crit"))
        hc = {**HOST, "ip": "192.168.1.9", "target": None}
        fresh = health.host_from_agent(hc, {"report": report, "fresh": True, "seen": 1.0})
        self.assertEqual((fresh["reachable"], fresh["os"], fresh["source"]), (True, "linux", "agent"))
        self.assertEqual(fresh["level"], health.host_level(fresh))
        self.assertTrue(fresh["reboot_required"])
        stale = health.host_from_agent(hc, {"report": report, "fresh": False, "seen": 1.0})
        self.assertFalse(stale["reachable"])
        self.assertEqual(stale["os"], "linux")   # an outdated Linux report is still a Linux machine
        # the other agent helpers must not choke on a Linux report
        self.assertIsNone(agents.system_of(report))
        self.assertEqual(agents.ports_of(report), {})
        self.assertIsNone(agents.docker_of(report))
        self.assertEqual(agents.services_of(report), [])
        self.assertIsNone(agents.hardware_of(report))


class LinuxAgentScripts(unittest.TestCase):
    """The scripts the server hands out: rendered, valid, and consistent with the collectors."""

    def test_agent_py_rendu_est_du_python_valide(self):
        text = agents.script("agent.py")
        for marker in ("__VERSION__", "__COMMANDS__", "__SMART_LIST__", "__SMART_FMT__"):
            self.assertNotIn(marker, text)
        code = compile(text, "agent.py", "exec")          # must be valid Python once rendered
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(code, ns)
        self.assertEqual(ns["VERSION"], agents.LINUX_VERSION)
        self.assertEqual(ns["COMMANDS"], health.LINUX_AGENT_COMMANDS)
        self.assertEqual(ns["SMART_LIST"], health.SMART_LIST_CMD)
        self.assertEqual(ns["SMART_FMT"].format(target="sda"), health.smart_cmd("sda"))   # same SMART command as the SSH collection

    def test_agent_ne_lance_que_la_liste_fixe(self):
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        asked = []
        ns["run"] = lambda cmd, timeout: (asked.append(cmd) or (0, "sda\nnvme0n1\nnvme0n1\n" if cmd == health.SMART_LIST_CMD else "x"))
        cmds = ns["collect"]()
        self.assertEqual(asked, health.LINUX_AGENT_COMMANDS + [health.smart_cmd("sda"), health.smart_cmd("nvme0")])   # one per disk, deduplicated
        self.assertEqual(set(cmds), set(asked))

    def test_agent_refuse_un_nom_de_disque_etrange(self):
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        asked = []
        ns["run"] = lambda cmd, timeout: (asked.append(cmd) or (0, "sda;reboot\n$(id)\nsdb\n" if cmd == health.SMART_LIST_CMD else "x"))
        ns["collect"]()
        self.assertEqual(asked[-1], health.smart_cmd("sdb"))
        self.assertFalse([c for c in asked if "sda;reboot" in c or "$(id)" in c])           # a disk name is never interpolated unchecked

    def test_install_sh_syntaxe_et_contenu(self):
        text = agents.script("install.sh")
        self.assertTrue(text.startswith("#!/usr/bin/env bash"))
        self.assertIn("msv_agent_", text)
        self.assertNotIn("MSV_TOKEN=msv_agent_", text)           # no token ever written in the script itself
        import shutil
        import subprocess
        if shutil.which("bash"):
            r = subprocess.run(["bash", "-n"], input=text.encode(), capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_commande_d_installation(self):
        win = agents.install_command("http://192.168.1.10:8090", "msv_agent_x")
        self.assertIn("iex (iwr", win)
        lin = agents.install_command("http://192.168.1.10:8090", "msv_agent_x", "linux")
        self.assertIn("export MSV_TOKEN='msv_agent_x'", lin)
        self.assertIn("/agent/install.sh", lin)
        self.assertIn('sudo env MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash', lin)
        self.assertNotIn("iex", lin)

    def test_versions_et_empreintes_par_type(self):
        self.assertEqual(agents.version_of("linux"), agents.LINUX_VERSION)
        self.assertEqual(agents.version_of("windows"), agents.VERSION)
        self.assertNotEqual(agents.script_sha256("agent.py"), agents.script_sha256("agent.ps1"))
        first, second = agents.script_sha256("agent.py"), agents.script_sha256("agent.py")
        self.assertEqual(first, second)   # stable: the agent compares it to what it downloads


if __name__ == "__main__":
    unittest.main()
