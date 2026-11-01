"""Linux agent, server side: a report carries the outputs of the commands the SSH collection runs, and the server replays them
through the same collectors (health.collect_linux). Nothing sent by an agent is ever executed here.

  python3 -m unittest tests.test_agents_linux
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import agents  # noqa: E402
from msv.collect import health  # noqa: E402

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

    def test_http_hors_reseau_local_refuse_pareil_sur_linux_et_windows(self):
        """Plain http would send the token in clear across the internet: same rule in both installers (`[[ =~ ]]` runs the Linux one for real)."""
        import re
        import shutil
        import subprocess
        linux = re.search(r"LOCAL_HOST='(.+)'", agents.script("install.sh"))[1]
        self.assertEqual(linux, re.search(r"\$LocalHost = '(.+)'", agents.script("install.ps1"))[1])
        self.assertIn('"${MSV_ALLOW_HTTP:-}" != 1', agents.script("install.sh"))
        self.assertIn("$env:MSV_ALLOW_HTTP -ne '1'", agents.script("install.ps1"))
        kept = ("192.168.1.10", "10.0.0.2", "172.16.0.1", "127.0.0.1", "100.100.1.1", "ms.lan", "ms.tail1234.ts.net", "myservices", "localhost", "[fd00::1]", "[::1]")
        refused = ("203.0.113.7", "ms.example.org", "172.32.0.1", "100.128.0.1", "[2001:db8::1]")
        for host in kept + refused:
            self.assertEqual(bool(re.search(linux, host)), host in kept, host)
            if shutil.which("bash"):
                r = subprocess.run(["bash", "-c", '[[ "$1" =~ $2 ]]', "x", host, linux])
                self.assertEqual(r.returncode == 0, host in kept, host)

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

    def test_npm_filtre_ce_qui_quitte_la_machine(self):
        ns = {"__name__": "agent_test", "__file__": "/tmp/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        adv = "location / {\n  proxy_pass http://10.0.0.5:8080;\n  proxy_set_header Authorization \"Bearer s3cret\";\n}\nset $acl_lan 1;\nauth_basic_user_file /x;"
        out = json.loads(ns["npm_clean"]("--host-list", json.dumps([{"id": 1, "owner": {"email": "a@b"}, "access_list": {"id": 2}, "advanced_config": adv}, {"id": 2, "advanced_config": "add_header X secret;"}])))
        self.assertEqual(out[0], {"id": 1, "advanced_config": "location / {\n  proxy_pass http://10.0.0.5:8080;\n}\nset $acl_lan 1;"})
        self.assertEqual(out[1]["advanced_config"], "# kept on the machine")   # still seen as set by the checks
        self.assertEqual(json.loads(ns["npm_clean"]("--access-list", '[{"id": 2, "name": "lan", "items": [{"username": "u"}]}]')), [{"id": 2, "name": "lan"}])

    def test_install_sh_rendu_sans_marqueur_et_empreinte_du_script_npm(self):
        from msv.remote import npmapi
        text = agents.script("install.sh")
        self.assertNotIn("__NPM_", text)
        self.assertIn(npmapi.SCRIPT_SHA256, text)
        self.assertIn(npmapi.SCRIPT_URL, text)

    def test_hyperviseurs_lus_par_l_agent(self):
        from msv.remote import virt_ssh
        incus = '[{"name": "web", "status": "Running", "type": "container"}]'
        rep = {"data": {"kind": "linux", "cmds": {virt_ssh.AGENT_CMD: [0, f"##INCUS\n{incus}\n##VIRSH\nsudo: a password is required\n"]}}}
        rows = virt_ssh.agent_rows(rep, "nas", "10.0.0.9")
        self.assertEqual([(r["connector"], r["via"], r["ip"]) for r in rows], [("incus", "agent", "10.0.0.9")])
        self.assertEqual(agents.rights_gaps(rep), ["hypervisors"])
        self.assertEqual(virt_ssh.agent_rows({"data": {"kind": "linux", "cmds": {virt_ssh.AGENT_CMD: [0, ""]}}}, "nas", "10.0.0.9"), [])   # no hypervisor here
        for _, args in virt_ssh.AGENT_STEP.values():   # the install writes these exact rules
            self.assertIn(args.replace("qemu:", "qemu\\:").split(" ", 1)[1], agents.script("install.sh"))

    def test_scan_root_refuse_ce_qui_sort_de_la_liste(self):
        from msv.backups import backups
        with tempfile.TemporaryDirectory() as d:
            ok, other = Path(d, "ok"), Path(d, "other")
            for p in (ok, other):
                p.mkdir()
                (p / "a.tar").write_text("x")
            (ok / "out").symlink_to(other)
            lst = Path(d, "dirs")
            lst.write_text(f"{ok}\n")
            src = backups.SCAN_HEAD.replace("/etc/myservices-agent/backup-dirs", str(lst)) + backups.AGENT
            req = {"locs": {"a": {"path": str(ok)}, "b": {"path": str(other)}, "c": {"path": str(ok / "out")}}, "disks": False, "crons": False,
                   "discover": ["/*"], "find": {"names": ["a"], "roots": ["/"]}}
            r = subprocess.run([sys.executable, "-c", src], input=json.dumps(req), capture_output=True, text=True, timeout=20)
            out = json.loads(r.stdout)
            kept = [d["path"] for d in out["local"]]   # the fixed patterns of the scan may find real folders on the machine running the test
            self.assertIn(str(ok.resolve()), kept)
            self.assertNotIn(str(other.resolve()), kept)   # the patterns of the server are not used
        self.assertEqual(list(out["locs"]), ["a"])
        self.assertNotIn("found", out)                                             # no name to look for here

    def test_scan_root_cherche_les_copies_sous_la_liste_seulement(self):
        from msv.backups import backups
        with tempfile.TemporaryDirectory() as d:
            ok, other = Path(d, "ok"), Path(d, "other")
            for p in (ok, other):
                p.mkdir()
                (p / "a.tar").write_text("x")
            lst = Path(d, "dirs")
            lst.write_text(f"{ok}\n")
            src = backups.SCAN_HEAD.replace("/etc/myservices-agent/backup-dirs", str(lst)) + backups.AGENT
            req = {"names": ["a.tar"], "find": {"names": ["a.tar"], "roots": [str(other)]}}
            r = subprocess.run([sys.executable, "-c", src], input=json.dumps(req), capture_output=True, text=True, timeout=20)
        self.assertEqual([h["dir"] for h in json.loads(r.stdout)["found"]["a.tar"]], [str(ok.resolve())])

    def test_machine_sans_ssh_lue_par_l_agent_seulement(self):
        from unittest import mock
        from msv.backups import backups, backups_admin
        scan = {"user": "root", "locs": {}, "local": [{"path": "/home/backup", "size": 1, "newest": 2}]}
        rep = {"10.0.0.9": {"fresh": True, "report": {"data": {"cmds": {"backups": [0, json.dumps(scan)]}}}}}
        with mock.patch.object(backups, "agent_reports", return_value=rep), mock.patch.object(backups, "run_py") as ssh:
            got = backups_admin._scan(("10.0.0.9", {"name": "vps", "ssh": None}), ["/x"])
            self.assertEqual(backups_admin._read_machine("10.0.0.8", None, {}, "local")[0], None)
            ssh.assert_not_called()
        self.assertEqual((got["ok"], got["folders"][0]["path"]), (True, "/home/backup"))

    def test_scan_de_l_agent_prefere_au_ssh(self):
        from msv.backups import backups
        scan = json.dumps({"user": "root", "locs": {"s#0": {"exists": True, "count": 1}}})
        rep = {"10.0.0.9": {"fresh": True, "report": {"data": {"cmds": {"backups": [0, scan]}}}}}
        req = {"locs": {"s#0": {"path": "/x"}}}
        self.assertEqual(backups.agent_scan({"ip": "10.0.0.9", "ssh": "nas"}, req, rep)["user"], "root")
        self.assertIsNone(backups.agent_scan({"ip": "10.0.0.8", "ssh": "nas"}, req, rep))
        self.assertIsNone(backups.agent_scan({"ip": "10.0.0.9", "ssh": "nas"}, {"locs": {"s#1": {}}}, rep))   # out of its list: SSH reads it
        refused = backups.agent_scan({"ip": "10.0.0.9"}, {"locs": {"s#1": {}}}, rep)                         # no SSH: said on the page
        self.assertIn("MSV_BACKUP_DIRS", refused["locs"]["s#1"]["error"])
        rep["10.0.0.9"]["report"]["data"]["cmds"]["backups"] = [1, "sudo: a password is required"]
        self.assertIsNone(backups.agent_scan({"ip": "10.0.0.9", "ssh": "nas"}, req, rep))

    def test_agent_rescanne_quand_le_serveur_demande_autre_chose(self):
        ns = {"__name__": "agent_test", "__file__": "/tmp/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        with tempfile.TemporaryDirectory() as d:
            ns["BACKUP_STATE"] = str(Path(d, "backups.json"))
            calls = []
            done = SimpleNamespace(returncode=0, stdout=b'{"locs": {}}', stderr=b"")
            ns["subprocess"] = SimpleNamespace(run=lambda *a, **k: (calls.append(k["input"]) or done), PIPE=-1, TimeoutExpired=TimeoutError)
            conf = {"python": "/usr/bin/python3", "script": "/x"}
            self.assertIsNone(ns["backup_scan"](conf, 1000))   # nothing asked yet
            ns["keep_backup_request"]({"locs": {"a": {}}})
            self.assertEqual(ns["backup_scan"](conf, 1000), [0, '{"locs": {}}'])
            ns["backup_scan"](conf, 2000)
            self.assertEqual(len(calls), 1)                    # kept
            ns["backup_scan"](conf, 1000 + ns["BACKUP_EVERY"])
            self.assertEqual(len(calls), 2)                    # too old
            ns["keep_backup_request"]({"locs": {"b": {}}})
            ns["backup_scan"](conf, 1000 + ns["BACKUP_EVERY"])
            self.assertEqual(len(calls), 3)                    # other folders

    def test_installeur_pose_pve_et_borgmatic_sans_entree_du_serveur(self):
        import subprocess
        from msv.remote.pve_ssh import PVE_CMD
        text = agents.script("install.sh")
        self.assertIn(PVE_CMD, text)
        self.assertNotIn("__PVE_CMD__", text)
        self.assertEqual(subprocess.run(["bash", "-n"], input=text.encode(), check=False).returncode, 0)
        self.assertIn("$BORG_UNIT.timer", text)

    def test_scan_dns_lit_les_outils_sans_les_comptes(self):
        ns = {"__name__": "dns_test"}
        exec(compile(agents.script("dns-scan.py"), "<dns-scan>", "exec"), ns)
        yaml = "users:\n  - name: admin\n    password: $2a$secret\nfiltering:\n  rewrites:\n    - domain: A.lan\n      answer: 10.0.0.1\n  user_rules:\n    - '||x.com^'\n"
        ns["read"] = lambda p: yaml if p == ns["ADGUARD_FILES"][0] else None
        got = ns["adguard"]({})
        self.assertEqual([x["domain"] for x in got["rewrites"]], ["a.lan"])
        self.assertEqual(got["user_rules"], ["||x.com^"])
        self.assertNotIn("secret", json.dumps(got))
        toml = 'x = 1\n  hosts = [\n    "10.0.0.2 nas.lan nas",\n    "10.0.0.3 tv.lan"\n  ] ### CHANGED\n'
        self.assertEqual([(x["domain"], x["answer"]) for x in ns["pihole_records"](toml, "10.0.0.4 old.lan\n")],
                         [("nas.lan", "10.0.0.2"), ("nas", "10.0.0.2"), ("tv.lan", "10.0.0.3"), ("old.lan", "10.0.0.4")])
        self.assertEqual([(x["domain"], x["answer"]) for x in ns["dnsmasq_records"]("address=/a.lan/10.0.0.5\n#address=/b/1\nhost-record=c.lan,10.0.0.6\n")],
                         [("a.lan", "10.0.0.5"), ("c.lan", "10.0.0.6")])
        self.assertEqual([(x["domain"], x["answer"]) for x in ns["unbound_records"]('  local-data: "d.lan. 3600 IN A 10.0.0.7"\n  local-data: "e.lan A 10.0.0.8"\n')],
                         [("d.lan", "10.0.0.7"), ("e.lan", "10.0.0.8")])

    def test_scan_dns_lit_les_zones_bind(self):
        ns = {"__name__": "dns_test"}
        exec(compile(agents.script("dns-scan.py"), "<dns-scan>", "exec"), ns)
        files = {"/etc/bind/named.conf": 'include "/etc/bind/local.conf";\noptions { directory "/var/cache/bind"; };\n',
                 "/etc/bind/local.conf": '// comment\nzone "home.lan" { type master; file "db.home"; };\nzone "0.0.10.in-addr.arpa" { type master; file "db.rev"; };\n'
                                         'zone "fwd.lan" { type forward; forwarders { 10.0.0.9; }; };\n',
                 "/var/cache/bind/db.home": '$TTL 3600\n@ IN SOA ns.home.lan. a.home.lan. (\n  2026 ; serial\n  1h )\n@ IN NS ns\n  IN A 10.0.0.1\nnas 3600 IN A 10.0.0.2 ; note\n'
                                            '  AAAA fd00::2\nabs.other.lan. A 10.0.0.3\n$ORIGIN sub.home.lan.\ntv A 10.0.0.4\nwww CNAME nas\n'}
        zones, base = ns["bind_zones"](files.get)
        self.assertEqual(zones, [("home.lan", "db.home")])
        ns["read"] = files.get
        from unittest import mock
        with mock.patch("os.path.exists", side_effect=lambda path: path == "/etc/bind/named.conf"):
            got = ns["bind"]({})
        self.assertEqual([(x["domain"], x["answer"]) for x in got["rewrites"]],
                         [("home.lan", "10.0.0.1"), ("nas.home.lan", "10.0.0.2"), ("nas.home.lan", "fd00::2"), ("abs.other.lan", "10.0.0.3"), ("tv.sub.home.lan", "10.0.0.4")])
        self.assertEqual(base, "/var/cache/bind")

    def test_connecteur_dns_agent_reunit_les_outils_et_adguard_passe_par_l_agent(self):
        from unittest import mock
        from connectors import adguard
        tools = {"pihole": {"rewrites": [{"domain": "a", "answer": "1", "enabled": True}], "user_rules": []}, "adguard": {"rewrites": [], "user_rules": ["r"], "version": "0.107"}}
        c = adguard.LocalDns({"name": "x", "ip": "10.0.0.2"}, mock.Mock())
        with mock.patch.object(adguard, "agent_dns", return_value=tools):
            got = c.collect()
            self.assertEqual((got["tools"], got["user_rules"]), (["adguard", "pihole"], ["r"]))
            ssh = mock.Mock()
            ag = adguard.AdGuard({"name": "x", "ip": "10.0.0.2", "ssh": "nas", "target": "c"}, ssh)
            self.assertEqual(ag.collect()["user_rules"], ["r"])
            self.assertEqual(ag.version(), "0.107")
            ssh.ssh.assert_not_called()
        with mock.patch.object(adguard, "agent_dns", return_value={}), self.assertRaisesRegex(adguard.ConnectorError, "case DNS"):
            c.collect()

    def test_install_sh_regles_npm_exactes(self):
        from msv.remote import npmapi
        text = agents.script("install.sh")
        for _, opt in npmapi.LISTS.values():
            self.assertIn(opt, text.split("for o in ")[1].split(";")[0].split())
        self.assertIn('ALL=($NPM_USER) NOPASSWD: $NPM --json $o', text)

    def test_v5_services_en_marche(self):
        from msv.collect import hostinfo
        out = "##UNITS /lib/systemd/system/cron.service /etc/systemd/system/backup-job.service /usr/lib/systemd/system/getty@.service /usr/local/lib/systemd/system/tool.service\n"
        self.assertEqual(hostinfo.parse_units(out), [{"name": "backup-job", "own": True}, {"name": "cron", "own": False}, {"name": "getty", "own": False}, {"name": "tool", "own": True}])
        self.assertEqual(hostinfo.parse_units("##OS Debian\n"), [])
        remote = "##OS Debian\n##UP 1\n"
        inv = agents.linux_inventory({"data": {"kind": "linux", "cmds": {hostinfo.REMOTE: [0, remote], hostinfo.UNITS_SH: [0, out]}}})
        self.assertEqual(inv["info"]["units"], hostinfo.parse_units(out))
        self.assertIsNone(agents.linux_inventory({"data": {"kind": "linux", "cmds": {hostinfo.REMOTE: [0, remote]}}})["info"]["units"])   # agent 4: still served, the page asks for its update

    def test_v4_inventaire_lu_comme_par_ssh(self):
        from msv.collect import hostinfo
        from connectors import docker_ssh, process
        remote = ("##OS Debian GNU/Linux 12 (bookworm)\n##KERNEL 6.1.0\n##UP 3600\n##SVC apache2=active nginx=inactive\n"
                  "##SSHDR no\n##DOCKERBIN yes\n##DOCKER 1\n##VIRT kvm\n")
        ps = "web|nginx:1|0.0.0.0:8080->80/tcp, 127.0.0.1:3011->3000/tcp|Up 2 days|site||||\n" + docker_ssh.ENV_MARK + "\n"
        ss = 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=1,fd=4))\nLISTEN 0 5 127.0.0.1:3011 0.0.0.0:*\n'
        report = {"data": {"kind": "linux", "cmds": {hostinfo.REMOTE: [0, remote], docker_ssh.DOCKER_SH: [0, ps],
                                                      docker_ssh.NET_SH: [0, "_host=192.168.1.61/24\n"], process.LISTEN_SH: [0, ss]}}}
        inv = agents.linux_inventory(report)
        self.assertEqual(inv["info"], {**hostinfo.parse_host_info(remote), "via": "agent", "units": None})
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

    def test_inventaire_servi_par_l_agent_seulement_complet(self):
        from msv.collect import hostinfo
        from connectors import docker_ssh, process
        remote = "##OS Debian\n##KERNEL 6.1\n##UPTIME 100\n"
        full = {hostinfo.REMOTE: [0, remote], docker_ssh.DOCKER_SH: [0, docker_ssh.ENV_MARK + "\n"], docker_ssh.NET_SH: [0, "_host=10.0.0.5/24\n"],
                process.LISTEN_SH: [0, 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))\n']}
        rep = lambda cmds: {"data": {"kind": "linux", "cmds": cmds}}  # noqa: E731
        self.assertTrue(agents.serves_inventory(rep(full)))
        self.assertEqual(agents.listening_ports(rep(full)), {22})
        for missing in (hostinfo.REMOTE, docker_ssh.NET_SH, process.LISTEN_SH):   # a missing section: SSH keeps reading, no port is taken for closed
            part = {k: v for k, v in full.items() if k != missing}
            self.assertFalse(agents.serves_inventory(rep(part)))
        self.assertIsNone(agents.listening_ports(rep({k: v for k, v in full.items() if k != process.LISTEN_SH})))
        self.assertFalse(agents.serves_inventory({"data": {"disks": []}}))
        self.assertEqual(agents.inventory_gaps({"data": {"disks": []}}), [])
        self.assertEqual(agents.inventory_gaps(rep(full)), [])
        nameless = {**full, process.LISTEN_SH: [0, "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n"]}   # `ss` without root: ports, no process
        self.assertEqual(agents.inventory_gaps(rep(nameless)), ["sudo"])
        self.assertEqual(agents.inventory_gaps(rep({k: v for k, v in full.items() if k != docker_ssh.NET_SH})), ["docker"])

    def test_droits_manquants_lus_dans_la_section_sante(self):
        rep = lambda out: {"data": {"kind": "linux", "cmds": {health.SYSTEM_CMD: [0, out]}}}  # noqa: E731
        self.assertEqual(agents.rights_gaps(rep("@@nr\nNOSUDO\n@@f2b\nNOSUDO\n")), ["needrestart", "fail2ban"])
        self.assertEqual(agents.rights_gaps(rep("@@nr\nNEEDRESTART-KSTA: 1\n@@f2b\nNOANSWER\n")), [])
        self.assertEqual(agents.rights_gaps(rep("@@nr\n@@f2b\n")), [])   # tools not installed
        self.assertEqual(agents.rights_gaps(rep("@@now 1\n")), [])        # agent too old for these sections
        self.assertEqual(agents.rights_gaps({"data": {"disks": []}}), [])  # Windows report
        self.assertEqual(agents.rights_gaps(None), [])

    def test_v4_info_machine_gardee_une_heure(self):
        from msv.collect import hostinfo
        ns: dict = {"__name__": "agent_under_test", "__file__": "/nonexistent/agent.py"}
        exec(compile(agents.script("agent.py"), "agent.py", "exec"), ns)
        self.assertEqual(ns["CACHED"][hostinfo.REMOTE], 3600)
        self.assertIn(hostinfo.UNITS_SH, ns["COMMANDS"])
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
