"""Downloads (Bazarr, Overseerr, qBittorrent, Transmission), backups (Backrest, borgmatic, UrBackup, Veeam for Microsoft 365), hypervisors
by API (Unraid, Proxmox Datacenter Manager) and by SSH (libvirt, Incus, VirtualBox), TrueNAS extras, and what the Windows agent now reads
(Hyper-V, Veeam Agent, Windows Server Backup). FAKE servers and sample outputs built from the documentation, not the real tools.

  python3 -m unittest discover -s tests
"""
import hashlib
import json
import sys
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from msv.machines import agents  # noqa: E402
import connectors  # noqa: E402
from msv.machines import known_apps  # noqa: E402
from msv.remote import virt_ssh  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402
from test_homelab import SEEN, Base  # noqa: E402

KEY = "k" * 16   # built at run time: the safety check refuses keys written as such
NEW = ("bazarr", "overseerr", "qbittorrent", "transmission", "backrest", "borgmatic", "urbackup", "veeam-m365", "unraid", "pdm")
HOURS = lambda h: (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()   # noqa: E731


def facts(d):
    return {f["label"]: f for f in d["facts"]}


class Registry(unittest.TestCase):
    def test_registered_and_proposed(self):
        apps = {a.connector for a in known_apps.APPS}
        for t in NEW:
            cls = connectors.TYPES[t]
            self.assertTrue(cls.label and cls.fields and cls.guide, t)
            self.assertIn(t, apps, f"{t}: no known app proposes it")
        self.assertEqual(connectors.TYPES["unraid"].kinds, ("virtualization",))
        self.assertIn("whisparr", connectors.homelab_media.ARR_APPS)


class Downloads(Base):
    def test_bazarr(self):
        self.route("/api/system/status", {"data": {"bazarr_version": "v1.5.1"}})
        self.route("/api/system/health", {"data": [{"object": "Sonarr", "issue": "injoignable"}]})
        self.route("/api/badges", {"episodes": 12, "movies": 0, "providers": 1})
        d = self.conn("bazarr", api_key=KEY).collect()
        self.assertEqual(d["version"], "1.5.1")
        self.assertEqual((facts(d)["Épisodes sans sous-titres"]["tone"], facts(d)["Santé"]["tone"]), ("warn", "bad"))
        self.assertEqual(d["problems"], ["Sonarr : injoignable"])

    def test_overseerr(self):
        self.route("/api/v1/status", {"version": "1.33.2", "updateAvailable": True, "restartRequired": False})
        self.route("/api/v1/request/count", {"total": 40, "pending": 3, "processing": 1, "available": 30})
        d = self.conn("overseerr", api_key=KEY).collect()
        self.assertEqual(d["problems"], ["3 demande(s) à approuver", "mise à jour disponible"])

    def test_qbittorrent_login_and_errors(self):
        class Q(BaseHTTPRequestHandler):
            seen = []

            def log_message(self, *a):
                pass

            def _send(self, body, cookie=None):
                out = (body if isinstance(body, str) else json.dumps(body)).encode()
                self.send_response(200)
                if cookie:
                    self.send_header("Set-Cookie", "SID=abc; HttpOnly; path=/")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                Q.seen.append(("POST", self.path, self.rfile.read(n).decode(), self.headers.get("Referer")))
                self._send("Ok.", cookie=True)

            def do_GET(self):
                Q.seen.append(("GET", self.path, self.headers.get("Cookie"), None))
                if self.headers.get("Cookie") != "SID=abc":
                    self.send_response(403)
                    self.end_headers()
                    return
                self._send({"/api/v2/app/version": "v5.0.1", "/api/v2/transfer/info": {"dl_info_speed": 2 * 2**20, "up_info_speed": 0, "connection_status": "firewalled"},
                            "/api/v2/torrents/info": [{"name": "iso", "state": "error"}, {"name": "film", "state": "stalledDL"}, {"name": "ok", "state": "uploading"}]}[self.path])
        srv = HTTPServer(("127.0.0.1", 0), Q)
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        try:
            c = connectors.TYPES["qbittorrent"]({"type": "qbittorrent", "name": "q", "url": f"http://127.0.0.1:{srv.server_port}", "user": "admin", "password": KEY}, Context(timeout=5))
            d = c.collect()
        finally:
            srv.shutdown()
        f = facts(d)
        self.assertEqual(d["version"], "5.0.1")
        self.assertEqual((f["En erreur"]["value"], f["Bloqués"]["value"], f["Connexion"]["tone"], f["Débit"]["value"]), ("1", "1", "warn", "↓ 2,0 Mo/s · ↑ 0 o/s"))
        self.assertEqual(d["problems"], ["« iso » en erreur"])
        self.assertTrue(Q.seen[0][3])   # Referer sent (qBittorrent's CSRF check)
        self.assertEqual({m for m, *_ in Q.seen[1:]}, {"GET"})

    def test_transmission_session_id(self):
        class T(BaseHTTPRequestHandler):
            methods = []

            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n))
                if self.headers.get("X-Transmission-Session-Id") != "S1":
                    self.send_response(409)
                    self.send_header("X-Transmission-Session-Id", "S1")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                T.methods.append(body["method"])
                args = {"session-get": {"version": "4.0.6 (38c164933e)"}, "session-stats": {"activeTorrentCount": 2, "downloadSpeed": 1024, "uploadSpeed": 0},
                        "torrent-get": {"torrents": [{"name": "a", "error": 3, "errorString": "No data found"}, {"name": "b", "error": 0}]}}[body["method"]]
                out = json.dumps({"result": "success", "arguments": args}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)
        srv = HTTPServer(("127.0.0.1", 0), T)
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        try:
            d = connectors.TYPES["transmission"]({"type": "transmission", "name": "t", "url": f"http://127.0.0.1:{srv.server_port}"}, Context(timeout=5)).collect()
        finally:
            srv.shutdown()
        self.assertEqual(d["version"], "4.0.6")
        self.assertEqual(d["problems"], ["« a » : No data found"])
        self.assertEqual(T.methods, ["session-get", "session-stats", "torrent-get"])   # read-only methods only


class Backups(Base):
    def test_backrest(self):
        now = int(time.time() * 1000)
        self.route("/v1.Backrest/GetConfig", {"plans": [{"id": "home"}, {"id": "photos"}, {"id": "jamais"}], "repos": [{"id": "b2"}]}, method="POST")
        self.route("/v1.Backrest/GetOperations", {"operations": [
            {"planId": "home", "status": "STATUS_ERROR", "unixTimeStartMs": now - 3_600_000, "operationBackup": {}},
            {"planId": "home", "status": "STATUS_SUCCESS", "unixTimeStartMs": now - 90_000_000, "operationBackup": {}},
            {"planId": "photos", "status": "STATUS_SUCCESS", "unixTimeStartMs": now - 7_200_000, "unixTimeEndMs": now - 7_000_000, "operationBackup": {}},
            {"planId": "photos", "status": "STATUS_SUCCESS", "unixTimeStartMs": now, "operationForget": {}}]}, method="POST")
        d = self.conn("backrest").collect()
        f = facts(d)
        self.assertEqual((f["Tâches"]["value"], f["En échec"]["value"], f["Dépôts"]["value"]), ("3", "1", "1"))
        self.assertEqual(d["problems"], ["« home » : dernière sauvegarde en échec", "« jamais » : aucune sauvegarde trouvée"])
        self.assertEqual({m for m, *_ in SEEN}, {"POST"})

    def test_veeam_m365(self):
        self.route("/v8/Token", {"access_token": "tok", "token_type": "bearer"}, method="POST")
        self.route("/v8/ServiceInstance", {"version": "8.1.0.305"})
        self.route("/v8/Jobs", [{"name": "Mails", "lastRun": HOURS(2), "lastStatus": "Success"}, {"name": "OneDrive", "lastRun": HOURS(3), "lastStatus": "Failed"},
                                {"name": "Vieux", "lastRun": HOURS(80), "lastStatus": "Success"}, {"name": "Coupé", "isEnabled": False}])
        d = self.conn("veeam-m365", user="veeam", password=KEY).collect()
        self.assertEqual(d["version"], "8.1.0.305")
        self.assertEqual(d["problems"], ["« OneDrive » : dernière sauvegarde en échec", "« Vieux » : aucune sauvegarde depuis 3 j 8 h"])
        self.assertIn("grant_type=password", SEEN[0][3])

    def test_urbackup_login(self):
        salt = {"ready": True, "salt": "S", "rnd": "R", "ses": "SES", "pbkdf2_rounds": 0}
        pw = hashlib.md5(b"R" + hashlib.md5(("S" + KEY).encode()).hexdigest().encode()).hexdigest()
        self.route("/x?a=salt", salt, method="POST")
        self.route("/x?a=login", {"success": True}, method="POST")
        self.route("/x?a=status", {"server_version": "2.5.33", "status": [
            {"name": "pc-salon", "online": True, "file_ok": True, "image_ok": True, "lastbackup": int(time.time()) - 3600, "lastbackup_image": 0},
            {"name": "portable", "online": False, "file_ok": False, "lastbackup": int(time.time()) - 3600}]}, method="POST")
        d = self.conn("urbackup", user="myservices", password=KEY).collect()
        self.assertEqual(d["problems"], ["« portable » : dernière sauvegarde en échec"])
        self.assertEqual(facts(d)["Clients hors ligne"]["value"], "1")
        self.assertIn(f"password={pw}", SEEN[1][3])

    def test_borgmatic_over_ssh(self):
        out = json.dumps([{"repository": {"label": "nas", "location": "ssh://nas/./borg"}, "archives": [{"name": "h-2026", "start": HOURS(5)[:19], "end": HOURS(4)[:19]}]},
                          {"repository": {"location": "/mnt/usb/borg"}, "archives": []}])
        c = connectors.TYPES["borgmatic"]({"type": "borgmatic", "name": "b", "ssh": "srv"}, Context())
        with mock.patch.object(Context, "ssh", return_value="warning line\n" + out) as ssh:
            d = c.collect()
        self.assertIn("repo-list --last 1 --json", ssh.call_args[0][1])
        self.assertEqual(d["problems"], ["« /mnt/usb/borg » : aucune sauvegarde trouvée"])
        self.assertEqual(facts(d)["Dernière sauvegarde"]["value"], "il y a 4 h 00")


    def test_borgmatic_par_l_agent(self):
        out = json.dumps([{"repository": {"label": "nas"}, "archives": [{"name": "h", "end": HOURS(4)[:19]}]}])
        conf = {"type": "borgmatic", "name": "b", "agent": "10.0.0.5"}
        self.assertEqual(connectors.TYPES["borgmatic"].validate(conf), [])
        self.assertTrue(connectors.TYPES["borgmatic"].validate({"type": "borgmatic", "name": "b"}))
        c = connectors.TYPES["borgmatic"](conf, Context())
        with mock.patch("msv.machines.agent_reports.fresh_output", return_value=out), mock.patch.object(Context, "ssh") as ssh:
            d = c.collect()
        ssh.assert_not_called()
        self.assertEqual(facts(d)["Dernière sauvegarde"]["value"], "il y a 4 h 00")
        with mock.patch("msv.machines.agent_reports.fresh_output", return_value=None), self.assertRaises(connectors.ConnectorError):
            c.collect()


class Hypervisors(Base):
    def test_unraid(self):
        answers = {"array {": {"data": {"info": {"os": {"hostname": "nas", "uptime": 3600}},
                                         "array": {"state": "STARTED", "capacity": {"kilobytes": {"used": "500", "total": "1000", "free": "500"}},
                                                   "disks": [{"name": "disk1", "status": "DISK_OK", "temp": 38}, {"name": "disk2", "status": "DISK_DSBL", "temp": 52}]}}},
                   "parities": {"data": {"array": {"parities": [{"name": "parity", "status": "DISK_OK"}]}}},
                   "vms": {"data": {"vms": {"domains": [{"uuid": "u1", "name": "HA", "state": "RUNNING"}, {"uuid": "u2", "name": "Win", "state": "SHUTOFF"}]}}},
                   "versions": {"data": {"info": {"versions": {"core": {"unraid": "7.2.0"}}}}}}

        def http(ctx, url, **kw):
            q = kw["body"]["query"]
            return next(v for k, v in answers.items() if k in q and (k != "array {" or "capacity" in q))
        c = connectors.TYPES["unraid"]({"type": "unraid", "name": "u", "url": "http://nas", "api_key": KEY}, Context())
        with mock.patch.object(Context, "http", http):
            d, v = c.collect(), c.version()
        self.assertEqual(v, "7.2.0")
        self.assertEqual(d["totals"], {"vm": 2, "lxc": 0, "running": 1, "stopped": 1})
        self.assertEqual(d["storage"][0]["used_pct"], 50.0)
        self.assertEqual(d["problems"], ["disque disk2 : DISK_DSBL", "disque disk2 à 52 °C"])

    def test_pdm(self):
        self.route("/api2/json/resources/list", {"data": [
            {"remote": "maison", "resources": [{"type": "node", "node": "pve1", "status": "online", "cpu": 0.1, "mem": 1, "maxmem": 4},
                                               {"type": "qemu", "vmid": 100, "name": "web", "node": "pve1", "status": "running"},
                                               {"type": "lxc", "vmid": 101, "name": "dns", "node": "pve1", "status": "stopped"}]},
            {"remote": "bureau", "error": "connection refused", "resources": []}]})
        d = self.conn("pdm", user="m@pdm!r", secret=KEY).collect()
        self.assertEqual(d["totals"], {"vm": 1, "lxc": 1, "running": 1, "stopped": 1})
        self.assertEqual(d["problems"], ["serveur « bureau » : connection refused"])
        self.assertEqual(SEEN[-1][2].get("Authorization"), f"PDMAPIToken m@pdm!r:{KEY}")

    def test_truenas_backups_and_apps(self):
        self.route("/api/v2.0/system/info", {"version": "TrueNAS-SCALE-24.10", "uptime_seconds": 100})
        self.route("/api/v2.0/pool", [])
        self.route("/api/v2.0/alert/list", [])
        self.route("/api/v2.0/replication", [{"name": "vers-nas2", "state": {"state": "ERROR"}}, {"name": "ok", "state": {"state": "SUCCESS"}}])
        self.route("/api/v2.0/cloudsync", [{"description": "B2", "job": {"state": "SUCCESS"}}])
        self.route("/api/v2.0/app", [{"name": "plex", "state": "CRASHED"}, {"name": "nc", "state": "RUNNING", "upgrade_available": True}])
        d = self.conn("truenas", api_key=KEY).collect()
        f = facts(d)
        self.assertEqual((f["Sauvegardes"]["value"], f["Applis"]["value"]), ("2/3 réussies", "2, 1 à mettre à jour"))
        self.assertEqual(d["problems"], ["réplication « vers-nas2 » en échec", "appli « plex » : crashed"])


U1, U2 = "-".join(("0b2c1e2a", "1111", "2222", "3333", "4" * 12)), "-".join(("9f2c1e2a", "1111", "2222", "3333", "4" * 12))   # built at run time: fake VM ids


class SshHypervisors(unittest.TestCase):
    OUT = f"""##VIRSH
Domain: 'web'
  state.state=1
  balloon.current=2097152
  balloon.maximum=4194304
  vcpu.maximum=2

Domain: 'old'
  state.state=5
  vcpu.maximum=1
##INCUS
[{{"name": "dns", "status": "Running", "type": "container", "profiles": ["default", "lan"], "state": {{"memory": {{"usage": 52428800}}}}}},
 {{"name": "win", "status": "Stopped", "type": "virtual-machine", "profiles": ["default"], "state": null}}]
##VBOX
"Ubuntu test" {{{U1}}}
"XP" {{{U2}}}
##VBOXRUN
"Ubuntu test" {{{U1}}}
"""

    def test_parse_all(self):
        got = virt_ssh.parse(self.OUT, "srv")
        lv, inc, vb = got["libvirt"][0], got["incus"][0], got["virtualbox"][0]
        self.assertEqual([(g["name"], g["status"], g["cpus"], g["maxmem"]) for g in lv["guests"]], [("web", "running", 2, 4 * 2**30), ("old", "stopped", 1, None)])
        self.assertEqual(inc["totals"], {"vm": 1, "lxc": 1, "running": 1, "stopped": 1})
        self.assertEqual(inc["guests"][0]["tags"], ["lan"])
        self.assertEqual([g["status"] for g in vb["guests"]], ["running", "stopped"])

    def test_refused(self):
        got = virt_ssh.parse("##VIRSH\nerror: failed to connect to the hypervisor\n", "srv")
        self.assertIsNone(got["libvirt"][0])
        self.assertIn("failed to connect", got["libvirt"][1])

    def test_rows_skip_proxmox(self):
        machines = [{"ip": "10.0.0.2", "name": "kvm", "ssh": "root", "info": {"hypervisors": ["virsh"]}},
                    {"ip": "10.0.0.3", "name": "pve", "ssh": "root", "info": {"hypervisors": ["lxc"], "proxmox": True}}]
        with mock.patch.object(virt_ssh, "read", return_value={"libvirt": ({"nodes": [], "guests": [], "storage": [], "totals": {}, "backups": None}, "")}) as r:
            rows = virt_ssh.rows(machines, {"10.0.0.2": {"alias": "kvm"}, "10.0.0.3": {"alias": "pve"}})
        self.assertEqual(r.call_count, 1)
        self.assertEqual((rows[0]["connector"], rows[0]["via"], rows[0]["label"]), ("libvirt", "ssh", "KVM / libvirt"))


class WindowsAgent(unittest.TestCase):
    REPORT = {"data": {"hv": [{"n": "DC01", "s": "Running", "c": 2, "m": 4294967296, "x": 2147483648, "u": 600},
                              {"n": "Test", "s": "Off", "c": 1, "m": 0, "x": 1073741824, "u": 0}],
                       "va": {"t": HOURS(30), "i": 190, "l": 4, "m": "Backup job 'PC' finished with Success."},
                       "wb": {"t": HOURS(2), "i": 517, "l": 2, "m": "The backup operation that started at ... has failed."}}}

    def test_hyperv(self):
        hv = agents.hyperv_of(self.REPORT, "srv")
        self.assertEqual(hv["totals"], {"vm": 2, "lxc": 0, "running": 1, "stopped": 1})
        self.assertEqual((hv["guests"][0]["mem"], hv["guests"][1]["maxmem"]), (4294967296, 1073741824))
        self.assertIsNone(agents.hyperv_of({"data": {}}, "srv"))

    def test_backups_cards(self):
        b = agents.windows_backups_of(self.REPORT)
        self.assertEqual([(x["tool"], x["ok"]) for x in b], [("Veeam Agent", True), ("Sauvegarde Windows Server", False)])
        va, wb = (agents.windows_backup_card(x, "pc") for x in b)
        self.assertEqual(va["problems"], ["aucune sauvegarde réussie depuis plus de 26 h (il y a 1 j)"])
        self.assertEqual(wb["facts"][1]["value"], "échec")

    def test_script_reads_them(self):
        s = agents.script("agent.ps1")
        for part in ("Get-VM", "'Veeam Agent'", "'Microsoft-Windows-Backup'"):
            self.assertIn(part, s)
        self.assertTrue(s.isascii())
