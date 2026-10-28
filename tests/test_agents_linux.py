"""Linux agent, server side: a report carries the outputs of the commands the SSH collection runs, and the server replays them
through the same collectors (health.collect_linux). Nothing sent by an agent is ever executed here.

  python3 -m unittest tests.test_agents_linux
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import agents  # noqa: E402
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
    health.GPU_CMD: (0, "NVIDIA T400, 9, 40, 200, 4096, 12.0\n---\n"),
    health.LOGS_CMD: (0, "3145728000 /var/log/big.log\n---\nArchived and active journals take up 1.5G in the file system.\n"),
    health.SYSTEM_CMD: (0, "@@now 1792678313\n@@pm2\nD 1158684 PM2 v5.4.3: God Daemon (/root/.pm2)\nE pm2-root.service enabled\n"
                           "U pm2-root.service active\n@@md\n@@zfs\n@@mnt\n@@ntp\nC none\nNTP=yes\nNTPSynchronized=yes\n@@tim\n@@uu\n@@snap\n@@who\n@@dkr\n"),
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
        self.assertEqual(direct["gpu"]["gpus"][0]["name"], "NVIDIA T400")   # same reading over SSH and through the agent
        self.assertTrue(direct["system"]["pm2"]["units"][0]["active"])
        self.assertTrue(all(len(c) <= agents.MAX_LINUX_CMD for c in health.LINUX_AGENT_COMMANDS))   # a report the server accepts

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
                    {"kind": "linux", "cmds": {"c" * (agents.MAX_LINUX_CMD + 1): [0, "x"]}},
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
        for marker in ("__VERSION__", "__COMMANDS__", "__SMART_LIST__", "__SMART_FMT__", "__CACHED__", "__SMART_CACHE__"):
            self.assertNotIn(marker, text)
        code = compile(text, "agent.py", "exec")          # must be valid Python once rendered
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(code, ns)
        self.assertEqual(ns["VERSION"], agents.LINUX_VERSION)
        self.assertEqual(ns["COMMANDS"], health.LINUX_AGENT_COMMANDS + agents.inventory_commands())
        self.assertEqual(ns["SMART_LIST"], health.SMART_LIST_CMD)
        self.assertEqual(ns["SMART_FMT"].format(target="sda"), health.smart_cmd("sda"))   # same SMART command as the SSH collection

    def test_agent_ne_lance_que_la_liste_fixe(self):
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        asked = []
        ns["run"] = lambda cmd, timeout: (asked.append(cmd) or (0, "sda\nnvme0n1\nnvme0n1\n" if cmd == health.SMART_LIST_CMD else "x"))
        cmds = ns["collect"]()
        self.assertEqual(asked, health.LINUX_AGENT_COMMANDS + agents.inventory_commands()
                         + [health.smart_cmd("sda"), health.smart_cmd("nvme0")])   # one per disk, deduplicated
        self.assertEqual(set(cmds), set(asked))

    def test_agent_refuse_un_nom_de_disque_etrange(self):
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        asked = []
        ns["run"] = lambda cmd, timeout: (asked.append(cmd) or (0, "sda;reboot\n$(id)\nsdb\n" if cmd == health.SMART_LIST_CMD else "x"))
        ns["collect"]()
        self.assertEqual(asked[-1], health.smart_cmd("sdb"))
        self.assertFalse([c for c in asked if "sda;reboot" in c or "$(id)" in c])           # a disk name is never interpolated unchecked

    def agent(self, cache_path):
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        ns["CACHE_PATH"] = cache_path
        return ns

    def test_v3_commandes_lentes_gardees_en_cache(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            ns = self.agent(str(Path(d) / "cache.json"))
            asked = []
            ns["run"] = lambda cmd, timeout: (asked.append(cmd) or (0, "sda\n" if cmd == health.SMART_LIST_CMD else "x"))
            first = ns["collect"]()
            asked.clear()
            second = ns["collect"]()
            slow = set(health.LINUX_AGENT_CACHE) | set(agents.inventory_cache()) | {health.smart_cmd("sda")}
            self.assertFalse(slow & set(asked))                       # apt, big logs, machine info and SMART: not run again within their lifetime
            self.assertEqual(set(asked), set(health.LINUX_AGENT_COMMANDS + agents.inventory_commands()) - slow)
            self.assertEqual(first, second)                           # their outputs are sent again, the report stays complete
            asked.clear()
            from unittest import mock
            with mock.patch.object(ns["time"], "time", return_value=10 ** 10):   # far later: everything is run again
                ns["collect"]()
            self.assertLessEqual(slow, set(asked))

    def test_v3_un_echec_n_est_pas_garde(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            ns = self.agent(str(Path(d) / "cache.json"))
            asked = []
            ns["run"] = lambda cmd, timeout: (asked.append(cmd) or ((100, "E: lock") if cmd == health.APT_CMD else (0, "")))
            ns["collect"]()
            asked.clear()
            ns["collect"]()
            self.assertIn(health.APT_CMD, asked)

    def test_v3_releve_compresse_et_coupe_si_trop_gros(self):
        import gzip
        import json
        import random
        ns = self.agent("/nonexistent/cache.json")
        meta = {"version": "3", "host": "box"}
        small = json.loads(gzip.decompress(ns["pack"](meta, {"a": [0, "x" * 1000]})))
        self.assertEqual((small["data"]["kind"], small["data"]["cmds"]["a"][1]), ("linux", "x" * 1000))
        rnd = random.Random(1)
        noise = lambda n: "".join(rnd.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(n))   # noqa: E731 (does not compress)
        big = {f"c{i}": [0, noise(49000)] for i in range(8)}
        body = ns["pack"](meta, big)
        self.assertLessEqual(len(body), ns["MAX_BODY"])
        got = json.loads(gzip.decompress(body))["data"]["cmds"]
        self.assertTrue(any("[cut by the agent" in v[1] for v in got.values()))
        self.assertEqual(set(got), set(big))                          # every command is still there, only some outputs are shorter

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

    def test_install_sh_regles_sudo_exactes(self):
        """MSV_SUDO=1 allows exactly the commands the collection runs through sudo -n: a rule that drifts would silently stop working."""
        from connectors.process import LISTEN_SH
        text = agents.script("install.sh")
        for cmd in (health.NEEDRESTART_ARGS, health.FAIL2BAN_ARGS):
            self.assertIn(f'"{cmd}"', text)
            self.assertIn(f"sudo -n {cmd}", health.as_root(cmd))
        self.assertIn("sudo -n ss -tlnpH", LISTEN_SH)
        self.assertIn(') -tlnpH"', text)
        self.assertNotIn("ALL=(root) NOPASSWD: ALL", text)

    def test_v4_inventaire_lu_comme_par_ssh(self):
        import hostinfo
        from connectors import docker_ssh, process
        remote = ("##OS Debian GNU/Linux 12 (bookworm)\n##KERNEL 6.1.0\n##UP 3600\n##SVC apache2=active nginx=inactive\n"
                  "##SSHDR no\n##DOCKERBIN yes\n##DOCKER 1\n##VIRT kvm\n")
        ps = "web|nginx:1|0.0.0.0:8080->80/tcp, 127.0.0.1:3011->3000/tcp|Up 2 days|site||||\n" + docker_ssh.ENV_MARK + "\n"
        ss = 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=1,fd=4))\nLISTEN 0 5 127.0.0.1:3011 0.0.0.0:*\n'
        report = {"data": {"kind": "linux", "cmds": {hostinfo.REMOTE: [0, remote], docker_ssh.DOCKER_SH: [0, ps],
                                                      docker_ssh.NET_SH: [0, "_host=192.168.1.61/24\n"], process.LISTEN_SH: [0, ss]}}}
        inv = agents.linux_inventory(report)
        self.assertEqual(inv["info"], {**hostinfo.parse_host_info(remote), "via": "agent"})
        self.assertEqual((inv["info"]["os"], inv["info"]["apache"]), ("Debian GNU/Linux 12 (bookworm)", True))
        self.assertEqual(inv["containers"], docker_ssh.parse_containers(ps))
        self.assertEqual((inv["containers"][0]["ports"], inv["containers"][0]["local_ports"]), ([(8080, 80)], [3011]))
        self.assertEqual(inv["internal"], {"192.168.1.61": "_host"})
        self.assertEqual(inv["ports"], {80: {"name": "apache2", "lan": True, "addr": "0.0.0.0"}})

    def test_v4_inventaire_absent_ou_docker_refuse(self):
        from connectors import docker_ssh
        self.assertIsNone(agents.linux_inventory({"data": {"disks": []}}))   # Windows report
        old = agents.linux_inventory({"data": {"kind": "linux", "cmds": {health.REBOOT_CMD: [0, "no\n"]}}})   # agent 3: nothing to read
        self.assertEqual(old, {"info": None, "containers": None, "internal": None, "ports": None})
        denied = {docker_ssh.DOCKER_SH: [1, "permission denied while trying to connect to the Docker daemon socket"]}
        self.assertIsNone(agents.linux_inventory({"data": {"kind": "linux", "cmds": denied}})["containers"])   # inaccessible, not absent
        missing = {docker_ssh.DOCKER_SH: [127, "sh: 1: docker: not found"]}
        self.assertEqual(agents.linux_inventory({"data": {"kind": "linux", "cmds": missing}})["containers"], [])   # no Docker here

    def test_v4_info_machine_gardee_une_heure(self):
        import hostinfo
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        self.assertEqual(ns["CACHED"][hostinfo.REMOTE], 3600)
        self.assertTrue(all(len(c) <= agents.MAX_LINUX_CMD for c in ns["COMMANDS"]))   # every command fits the server limit

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
