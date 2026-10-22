"""Services and storage checks (PM2 without the pm2 command, RAID, ZFS, network shares, clock, timers, automatic updates, Snap, sessions,
Docker restart loops) and the SSH collection in one connection.

  python3 -m unittest tests.test_health_system
"""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import health  # noqa: E402

NOW = 1792678313   # 2026-10-22 14:11:53 UTC


def system(out: str) -> dict:
    return health.collect_system(lambda cmd, timeout=15: (0, out) if cmd == health.SYSTEM_CMD else (127, ""))


class Pm2(unittest.TestCase):
    def test_lu_sans_la_commande_pm2(self):
        self.assertNotRegex(health.SYSTEM_CMD, r"(^|[;|&]\s*)pm2 ")   # the pm2 command starts its daemon: never called

    def test_daemon_arrete_avec_applis_enregistrees(self):
        p = health.parse_pm2(["H /home/u/.pm2", "S api", "S web"])
        self.assertFalse(p["running"])
        self.assertEqual(health.system_levels({"pm2": p})["pm2"], "warn")

    def test_appli_arretee_daemon_actif(self):
        p = health.parse_pm2(["D PM2 v5.4.3: God Daemon (/home/u/.pm2)", "H /home/u/.pm2", "P up api-0", "P down web-1", "S api", "S web"])
        self.assertEqual([(a["name"], a["up"]) for a in p["apps"]], [("api", True), ("web", False)])
        self.assertEqual(health.system_levels({"pm2": p})["pm2"], "warn")

    def test_unite_root_arretee(self):
        p = health.parse_pm2(["E pm2-root.service enabled", "U pm2-root.service inactive"])
        self.assertEqual(health.system_levels({"pm2": p})["pm2"], "warn")
        ok = health.parse_pm2(["D PM2 v5.4.3: God Daemon (/root/.pm2)", "E pm2-root.service enabled", "U pm2-root.service active"])
        self.assertEqual(health.system_levels({"pm2": ok})["pm2"], "ok")

    def test_dossier_vide_sans_appli_pas_d_alerte(self):
        p = health.parse_pm2(["H /home/u/.pm2"])
        self.assertTrue(p["available"])
        self.assertEqual(health.system_levels({"pm2": p})["pm2"], "ok")
        self.assertFalse(health.parse_pm2([])["available"])


class Storage(unittest.TestCase):
    def test_raid_degrade_ou_reconstruction(self):
        ok = ["md2 : active raid1 sdb2[1] sda2[0]", "      976 blocks super 1.2 [2/2] [UU]"]
        self.assertEqual(health.system_levels({"raid": health.parse_mdstat(ok)})["raid"], "ok")
        bad = ["md2 : active raid1 sda2[0]", "      976 blocks super 1.2 [2/1] [U_]"]
        self.assertEqual(health.system_levels({"raid": health.parse_mdstat(bad)})["raid"], "crit")
        rebuild = bad + ["      [==>.......]  recovery = 12.6% (1/8) finish=10min"]
        r = health.parse_mdstat(rebuild)
        self.assertEqual(r["arrays"][0]["rebuild"]["pct"], 12.6)
        self.assertEqual(health.system_levels({"raid": r})["raid"], "warn")
        self.assertFalse(health.parse_mdstat([])["available"])

    def test_zfs(self):
        self.assertEqual(health.system_levels({"zfs": health.parse_zfs(["tank\tONLINE"])})["zfs"], "ok")
        self.assertEqual(health.system_levels({"zfs": health.parse_zfs(["tank\tDEGRADED"])})["zfs"], "warn")
        self.assertEqual(health.system_levels({"zfs": health.parse_zfs(["tank\tFAULTED"])})["zfs"], "crit")

    def test_partages_reseau(self):
        m = health.parse_mounts(["T /mnt/freebox", "T /mnt/nas\\x20photos", "T /mnt/hs", "R 0 /mnt/freebox", "R 0 /mnt/nas\\x20photos",
                                 "F /mnt/freebox", "F /mnt/absent"])
        self.assertEqual({s["path"]: s["state"] for s in m["shares"]},
                         {"/mnt/freebox": "ok", "/mnt/nas photos": "ok", "/mnt/hs": "hang", "/mnt/absent": "missing"})
        self.assertEqual(health.system_levels({"mounts": m})["mounts"], "crit")
        m = health.parse_mounts(["T /mnt/a", "R 116 /mnt/a"])   # stale handle
        self.assertEqual(health.system_levels({"mounts": m})["mounts"], "warn")


class System(unittest.TestCase):
    def test_heure(self):
        self.assertEqual(health.system_levels({"ntp": health.parse_ntp(["C none", "NTP=yes", "NTPSynchronized=no"])})["ntp"], "warn")
        self.assertFalse(health.parse_ntp(["C lxc", "NTPSynchronized=no"])["available"])   # a container takes the host's clock

    def test_timers(self):
        t = health.parse_timers(["Result=success", "Id=a.service", "ActiveState=inactive", "Result=exit-code", "Id=b.service", "ActiveState=failed"])
        self.assertEqual((t["total"], t["failed"]), (2, ["b.service"]))
        self.assertEqual(health.system_levels({"timers": t})["timers"], "warn")

    def test_mises_a_jour_automatiques(self):
        base = ["I install ok installed", 'APT::Periodic::Unattended-Upgrade "1";']
        fresh = health.parse_unattended(base + [f"S {NOW - 3600}"], NOW)
        self.assertEqual(health.system_levels({"auto_upd": fresh})["auto_upd"], "ok")
        old = health.parse_unattended(base + [f"S {NOW - 5 * 86400}"], NOW)
        self.assertEqual(health.system_levels({"auto_upd": old})["auto_upd"], "warn")
        off = health.parse_unattended(["I install ok installed", 'APT::Periodic::Unattended-Upgrade "0";'], NOW)
        self.assertNotIn("auto_upd", health.system_levels({"auto_upd": off}))
        self.assertFalse(health.parse_unattended([], NOW)["available"])

    def test_snap_et_sessions(self):
        s = health.parse_snap(["Name     Version  Rev   Size  Publisher  Notes", "firefox  131.0    5000  80MB  mozilla**  -"])
        self.assertEqual((s["pending"], s["names"]), (1, ["firefox"]))
        self.assertEqual(health.parse_snap(["All snaps up to date."])["pending"], 0)
        self.assertFalse(health.parse_snap([])["available"])
        w = health.parse_sessions(["debian32 pts/2        2026-10-22 10:34 (212.203.103.210)"])
        self.assertEqual(w["sessions"][0], {"user": "debian32", "tty": "pts/2", "from": "212.203.103.210"})

    def test_conteneur_en_boucle(self):
        loops = health.parse_docker_loops(["/web|7|2026-10-22T13:50:00.1Z", "/db|7|2026-10-20T13:50:00Z", "/ok|0|2026-10-22T13:50:00Z"], NOW)
        self.assertEqual(loops, [{"name": "web", "restarts": 7}])
        self.assertEqual(health.docker_level({"accessible": True, "loops": loops}), "warn")

    def test_releve_complet_et_absent(self):
        h = system("@@now %d\n@@pm2\n@@md\n@@zfs\n@@mnt\n@@ntp\nC none\nNTP=yes\nNTPSynchronized=yes\n@@tim\n@@uu\n@@snap\n@@who\n@@dkr\n" % NOW)
        self.assertEqual(health.system_levels(h), {"ntp": "ok"})   # absent tools: no check at all
        self.assertEqual(system("bash: syntax error"), {})
        self.assertEqual(health.system_levels(None), {})

    def test_commande_executable_ici(self):
        r = subprocess.run(["bash", "-c", health.SYSTEM_CMD], capture_output=True, text=True, timeout=40)
        self.assertEqual(r.returncode, 0)
        self.assertIn("@@dkr", r.stdout)


class NeedsRoot(unittest.TestCase):
    def test_needrestart(self):
        n = health.parse_needrestart(["NEEDRESTART-VER: 3.11", "NEEDRESTART-KSTA: 3", "NEEDRESTART-SVC: nginx.service", "NEEDRESTART-SVC: dbus.service"], "u")
        self.assertEqual((n["services"], n["kernel_pending"]), (["nginx.service", "dbus.service"], True))
        self.assertEqual(health.parse_needrestart(["NEEDRESTART-VER: 3.11", "NEEDRESTART-KSTA: 1"], "u")["services"], [])
        self.assertFalse(health.parse_needrestart([], "u")["available"])

    def test_regle_sudo_exacte_quand_refuse(self):
        n = health.parse_needrestart(["NOSUDO"], "debian32")
        self.assertEqual((n["access"], n["rule"]), (False, "debian32 ALL=(root) NOPASSWD: /usr/sbin/needrestart -b -r l"))
        f = health.parse_fail2ban(["NOSUDO"], "debian32")
        self.assertEqual(f["rule"], "debian32 ALL=(root) NOPASSWD: /usr/bin/fail2ban-client banned")
        self.assertNotIn("*", f["rule"] + n["rule"])                           # one exact command, never a wildcard
        self.assertIn("-r l", health.SYSTEM_CMD)                                 # needrestart in list mode: it never restarts anything

    def test_fail2ban(self):
        f = health.parse_fail2ban(["[{'sshd': ['1.2.3.4', '5.6.7.8']}, {'nginx': []}]"], "u")
        self.assertEqual((f["jails"], f["total"]), ([{"name": "nginx", "banned": 0}, {"name": "sshd", "banned": 2}], 2))
        self.assertFalse(health.parse_fail2ban(["__import__('os').system('id')"], "u")["available"])   # read as a literal, never run
        self.assertFalse(health.parse_fail2ban([], "u")["available"])


class OneConnection(unittest.TestCase):
    def test_lot_rejoue_chaque_commande(self):
        cmds = ["echo \"it's\"", "echo out; echo err >&2; exit 3", "printf '@@0 0\\nZm9v\\n'", "true"]
        out = subprocess.run(["bash", "-c", health.batch_script(cmds)], capture_output=True, text=True, timeout=30).stdout
        rec = health.parse_batch(cmds, out)
        self.assertEqual(rec[cmds[0]], [0, "it's\n"])
        self.assertEqual(rec[cmds[1]], [3, "out\nerr"])                  # stdout + stderr when it failed, like run()
        self.assertEqual(rec[cmds[2]], [0, "@@0 0\nZm9v\n"])             # an output that looks like a marker stays an output
        self.assertEqual(rec[cmds[3]], [0, ""])

    def test_sortie_tronquee(self):
        self.assertEqual(health.parse_batch(["a", "b"], "@@0 0\nb2s=\n@@1 0"), {"a": [0, "ok"]})
        self.assertEqual(health.parse_batch(["a"], "@@5 0\nb2s=\n@@0 0\n!!!"), {})

    def test_trois_connexions_par_machine(self):
        calls = []

        def run(cmd, timeout=15):
            calls.append(cmd)
            if cmd.startswith("echo ok"):
                return 0, "ok\n"
            quoted = health.SMART_LIST_CMD.replace("'", "'\\''")   # as batch_script writes it
            fake = cmd.replace("sudo -n /usr/sbin/smartctl", "echo PASSED overall-health").replace(quoted, "printf sda\\\\nsdb")
            return 0, subprocess.run(["bash", "-c", fake], capture_output=True, text=True, timeout=120).stdout
        orig = health.make_runner
        health.make_runner = lambda host: run
        try:
            h = health.collect_host({"id": "x", "name": "x", "mode": "ssh", "target": "x"})
        finally:
            health.make_runner = orig
        self.assertTrue(h["reachable"])
        self.assertEqual(len(calls), 3)                                   # access, every command, SMART for both disks
        self.assertEqual([d["device"] for d in h["smart"]["disks"]], ["sda", "sdb"])
        self.assertIn("system", h)

    def test_esxi_et_injoignable(self):
        orig = health.make_runner
        try:
            health.make_runner = lambda host: lambda cmd, timeout=15: (0, "ok\nVMware ESXi 8.0.2\n")
            self.assertEqual(health.collect_host({"id": "e", "name": "e", "mode": "ssh", "target": "e"})["esxi"], "VMware ESXi 8.0.2")
            health.make_runner = lambda host: lambda cmd, timeout=15: (255, "Connection refused")
            self.assertFalse(health.collect_host({"id": "e", "name": "e", "mode": "ssh", "target": "e"})["reachable"])
        finally:
            health.make_runner = orig


if __name__ == "__main__":
    unittest.main()
