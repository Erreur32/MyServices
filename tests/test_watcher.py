"""watcher.py : alerte « connecteur en panne » confirmée sur CONFIRM_RUNS passages, puis « rétabli ».

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import watcher  # noqa: E402


def data(ok):
    return {"connectors": [{"type": "beszel", "name": "hub", "ok": ok, "message": "OK" if ok else "HTTP 400 : Failed to authenticate."}]}


class Connectors(unittest.TestCase):
    def run_seq(self, seq):
        prev, pending, out = watcher.connector_snaps(data(seq[0])), {}, []
        for ok in seq[1:]:
            cur = watcher.connector_snaps(data(ok))
            ev, pending = watcher.diff_connectors(prev, cur, pending)
            out.append([e["kind"] for e in ev])
            prev = cur
        return out

    def test_confirmed_failure_then_recovery(self):
        self.assertEqual(watcher.CONFIRM_RUNS, 2)
        self.assertEqual(self.run_seq([True, False, False, False, True, True]), [[], ["connecteur"], [], [], ["connecteur_ok"]])

    def test_single_blip_ignored(self):
        self.assertEqual(self.run_seq([True, False, True, True]), [[], [], []])

    def test_detail_is_the_connector_message(self):
        prev = watcher.connector_snaps(data(True))
        ev, p = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), {})
        ev, _ = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), p)
        self.assertEqual(ev[0]["detail"], "HTTP 400 : Failed to authenticate.")
        self.assertIn("connecteur", watcher.LABEL)


class SameCollection(unittest.TestCase):
    """A run started by the pulse sees the data.json of the run before: it must not confirm a service outage by itself."""

    def gen(self, n):
        from datetime import datetime, timedelta, timezone
        if not hasattr(self, "_t0"):   # one clock reading per test: two calls with the same n must give the same collection time
            self._t0 = datetime.now(timezone.utc)
        return (self._t0 - timedelta(minutes=10 - n)).isoformat(timespec="seconds")   # n-th collection, all recent

    def run_main(self, d, generated, up, pulse_ping=None):
        import json
        import tempfile
        from unittest import mock
        host = {"type": "local", "id": 1, "name": "web", "enabled": True, "ip": "10.0.0.5", "port": 80, "domains": [],
                "backend": {"up": up}, "public": {}}
        data = {"generated": generated, "hosts": [host], "machine_list": [{"ip": "10.0.0.2", "name": "pc", "ping": True, "ssh": None}], "page": {}}
        (d / "data.json").write_text(json.dumps(data), encoding="utf-8")
        live = {"10.0.0.2": {"ping": pulse_ping}} if pulse_ping is not None else {}
        with mock.patch.object(watcher, "DATA", d / "data.json"), mock.patch.object(watcher, "EVENTS", d / "events.json"), \
                mock.patch.object(watcher, "STATE_DIR", d), mock.patch.object(watcher, "STATE_FILE", d / "state.json"), \
                mock.patch.object(watcher.pulse, "read", return_value=live), mock.patch.object(watcher, "notify_discord", return_value=""), \
                mock.patch.object(watcher.notify, "telegram_on", return_value=False), mock.patch.dict(watcher.os.environ, {"MYSERVICES_ALERTS_ENGINE": "1"}):
            watcher.main()
        return [e["kind"] for e in json.loads((d / "events.json").read_text(encoding="utf-8"))["events"]]

    def test_pulse_run_does_not_confirm_a_service_alone(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            self.run_main(d, self.gen(1), True)                                  # baseline
            self.assertNotIn("panne", self.run_main(d, self.gen(2), False))      # first collection that sees it down: not confirmed yet
            self.assertNotIn("panne", self.run_main(d, self.gen(2), False))      # a run between two collections: still not
            self.assertIn("panne", self.run_main(d, self.gen(3), False))         # the second collection confirms

    def test_pulse_run_still_reports_a_machine_that_moved(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            self.run_main(d, self.gen(1), True)
            self.assertIn("hors_ligne", self.run_main(d, self.gen(1), True, pulse_ping=False))


class Network(unittest.TestCase):
    """« New device on the network » (MynetworK): reference on the first reading, then one event per unknown device."""

    @staticmethod
    def data(*devices, followed=("10.0.0.2",)):
        return {"machine_list": [{"ip": ip} for ip in followed],
                "network": [{"devices": [{"ip": ip, "mac": mac, "hostname": None, "vendor": "Espressif", "status": "online"} for ip, mac in devices]}]}

    def test_reference_puis_nouvel_appareil(self):
        d1 = self.data(("10.0.0.2", "AA:00:00:00:00:02"), ("10.0.0.7", "AA:00:00:00:00:07"))
        ev, known = watcher.diff_network(None, watcher.network_snaps(d1))
        self.assertEqual((ev, list(known)), ([], ["appareil:AA:00:00:00:00:07"]))   # followed machine left out
        d2 = self.data(("10.0.0.8", "AA:00:00:00:00:07"), ("10.0.0.9", "AA:00:00:00:00:09"))   # same MAC, new IP: not new
        ev, known = watcher.diff_network(known, watcher.network_snaps(d2))
        self.assertEqual([(e["kind"], e["target"], e["label"]) for e in ev], [("appareil", "10.0.0.9", "Espressif")])
        self.assertIn("AA:00:00:00:00:09", ev[0]["detail"])
        self.assertEqual(watcher.diff_network(known, watcher.network_snaps(self.data(("10.0.0.9", "AA:00:00:00:00:09"))))[0], [])

    def test_outil_coupe_garde_ce_qui_est_connu(self):
        _, known = watcher.diff_network(None, watcher.network_snaps(self.data(("10.0.0.7", None))))
        self.assertEqual(watcher.diff_network(known, None), ([], known))
        self.assertEqual(list(known), ["appareil:10.0.0.7"])   # no MAC: keyed by IP
        self.assertIn("appareil", watcher.LABEL)
        self.assertIn("appareil", __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)


class Virt(unittest.TestCase):
    """Proxmox guest stopped / started and storage nearly full, confirmed on two runs."""

    @staticmethod
    def data(status="running", pct=50.0, ok=True):
        return {"virtualization": [{"connector": "proxmox", "ok": ok, "stale": False,
                                    "guests": [{"vmid": 101, "name": "Monitor", "type": "qemu", "node": "pve", "status": status, "template": False}],
                                    "storage": [{"name": "nvme1", "node": "pve", "used_pct": pct}]}]}

    def run_seq(self, seq):
        prev, pending, out = watcher.virt_snaps(seq[0]), {}, []
        for d in seq[1:]:
            cur = watcher.virt_snaps(d)
            ev, pending = watcher.diff_virt(prev, cur, pending)
            out.append([(e["kind"], e["label"]) for e in ev])
            prev = {**prev, **cur}
        return out

    def test_vm_arretee_puis_relancee(self):
        d = self.data
        self.assertEqual(self.run_seq([d(), d("stopped"), d("stopped"), d(), d()]),
                         [[], [("vm_arret", "Monitor")], [], [("vm_marche", "Monitor")]])

    def test_stockage_plein_et_hote_illisible(self):
        d = self.data
        self.assertEqual(self.run_seq([d(), d(pct=95), d(pct=95)]), [[], [("stockage", "nvme1")]])
        self.assertEqual(watcher.virt_snaps(d("stopped", ok=False)), {})   # host not read: nothing to compare
        for k in ("vm_arret", "stockage"):
            self.assertIn(k, watcher.LABEL)
            self.assertIn(k, __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)


class Threats(unittest.TestCase):
    """« New threat » (LogviewR): the first reading is the reference, then one event per new cluster."""

    @staticmethod
    def data(*keys, ok=True):
        return {"security": [{"name": "lv", "ok": ok, "threats": [{"key": k, "kind": "ip_escalation", "ips": ["203.0.113.5"], "ip_count": 1,
                                                                    "jails": ["sshd", "nginx"], "bans": 4} for k in keys]}]}

    def test_reference_puis_nouvelle(self):
        ev, known = watcher.diff_threats(None, watcher.threat_snaps(self.data("a")))
        self.assertEqual(ev, [])
        ev, known = watcher.diff_threats(known, watcher.threat_snaps(self.data("a", "b")))
        self.assertEqual([(e["kind"], e["label"], e["target"]) for e in ev], [("menace", "203.0.113.5", "sshd, nginx")])
        self.assertIn("4 bannissement(s)", ev[0]["detail"])
        self.assertEqual(watcher.diff_threats(known, watcher.threat_snaps(self.data("b")))[0], [])
        self.assertIsNone(watcher.threat_snaps(self.data("c", ok=False)))   # LogviewR not read: known threats kept
        self.assertEqual(watcher.diff_threats(known, None), ([], known))
        self.assertIn("menace", __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)


class NextcloudPoints(unittest.TestCase):
    """« Nextcloud to look at »: once per point (stable key), the first reading is the reference."""

    @staticmethod
    def data(*checks, ok=True):
        return {"services_status": [{"connector": "nextcloud", "name": "cloud", "ok": ok,
                                     "checks": [{"key": k, "text": t} for k, t in checks]},
                                    {"connector": "prometheus", "name": "p", "ok": True, "checks": [{"key": "x", "text": "y"}]}]}

    def test_une_fois_par_point(self):
        ev, known = watcher.diff_nextcloud(None, watcher.nextcloud_snaps(self.data(("links", "1 lien(s) public(s) sans mot de passe"))))
        self.assertEqual(ev, [])
        ev, known = watcher.diff_nextcloud(known, watcher.nextcloud_snaps(self.data(("links", "3 lien(s) public(s) sans mot de passe"),
                                                                                    ("update", "mise à jour de Nextcloud disponible : 30.0.2"))))
        self.assertEqual([(e["kind"], e["label"], e["detail"]) for e in ev], [("nextcloud", "cloud", "mise à jour de Nextcloud disponible : 30.0.2")])
        self.assertEqual(watcher.diff_nextcloud(known, None), ([], known))   # Nextcloud not read: points kept
        self.assertIsNone(watcher.nextcloud_snaps(self.data(("debug", "x"), ok=False)))
        self.assertNotIn("nextcloud:p:x", watcher.nextcloud_snaps(self.data()))   # other status connectors: not here
        self.assertIn("nextcloud", __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)


class ImageUpdates(unittest.TestCase):
    """« Image to update »: once per container with a newer image (stable key), the first reading is the reference."""

    @staticmethod
    def data(*updates, ok=True, links_only=False):
        return {"containers": [{"connector": "dozzle", "name": "dz", "ok": ok, "links_only": links_only,
                                "environments": [{"id": 7, "name": "Dev", "host": "10.0.0.5:7007",
                                                  "updates": [{"container": c, "image": i, "newer": None} for c, i in updates]}]}]}

    def test_une_fois_par_conteneur(self):
        ev, known = watcher.diff_points("maj_image", None, watcher.image_snaps(self.data(("web", "nginx:1.25"))))
        self.assertEqual(ev, [])   # the first reading is the reference
        ev, known = watcher.diff_points("maj_image", known, watcher.image_snaps(self.data(("web", "nginx:1.25"), ("db", "postgres:16"))))
        self.assertEqual([(e["kind"], e["label"], e["machine"], e["target"]) for e in ev], [("maj_image", "db", "Dev", "postgres:16")])
        self.assertIn("postgres:16", ev[0]["detail"])
        self.assertEqual(watcher.diff_points("maj_image", known, None), ([], known))   # no container tool read: what was known is kept
        self.assertIsNone(watcher.image_snaps(self.data(("web", "x"), ok=False)))
        self.assertIsNone(watcher.image_snaps(self.data(("web", "x"), links_only=True)))
        self.assertIn("maj_image", __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)
        self.assertIn("maj_image", watcher.SEVERITY)
        self.assertIn("maj_image", watcher.LABEL)


class JailSurges(unittest.TestCase):
    """« Jail going up »: the last 24 hours far above the six days before, from the LogviewR statistics."""

    @staticmethod
    def data(*jails, ok=True, stats=True):
        by = [{"jail": j, "d1": d1, "d7": d7} for j, d1, d7 in jails]
        return {"security": [{"connector": "logviewr", "name": "lv", "ok": ok, "stats": {"by_jail": by} if stats else None}]}

    def test_hausse_nette_seulement(self):
        snaps = watcher.jail_surge_snaps(self.data(("sshd", 60, 90),        # 60 today, 5 a day before: up
                                                   ("npm-4xx", 55, 330),    # 55 today, 46 a day before: normal
                                                   ("nginx", 8, 8)))        # 8 bans: too few to matter
        self.assertEqual(list(snaps), ["jail_hausse:lv:sshd"])
        self.assertIn("60 bannissement(s) en 24 h, contre 5 par jour", snaps["jail_hausse:lv:sshd"]["text"])

    def test_une_fois_puis_de_nouveau_apres_le_retour_au_calme(self):
        up = watcher.jail_surge_snaps(self.data(("sshd", 60, 90)))
        calm = watcher.jail_surge_snaps(self.data(("sshd", 4, 30)))
        ev, known = watcher.diff_points("jail_hausse", None, up)
        self.assertEqual(ev, [])
        self.assertEqual(watcher.diff_points("jail_hausse", known, up)[0], [])   # still up: nothing new
        ev, known = watcher.diff_points("jail_hausse", known, calm)
        self.assertEqual((ev, known), ([], {}))
        ev, _ = watcher.diff_points("jail_hausse", known, up)                    # up again after a calm spell: a new event
        self.assertEqual([(e["kind"], e["label"], e["target"]) for e in ev], [("jail_hausse", "sshd", "lv")])

    def test_sans_statistiques_ou_en_panne_rien(self):
        self.assertIsNone(watcher.jail_surge_snaps(self.data(("sshd", 60, 90), stats=False)))
        self.assertIsNone(watcher.jail_surge_snaps(self.data(("sshd", 60, 90), ok=False)))
        self.assertIn("jail_hausse", __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS)


class AlertsLevel(unittest.TestCase):
    """The alerts level set on the service page: « down » keeps only outages and returns, « none » keeps nothing."""
    def rows(self, alerts, up):
        r = {"type": "local", "id": "10.0.0.2:80", "ip": "10.0.0.2", "port": 80, "enabled": True, "domains": [], "web": None if up else "ui",
             "backend": {"up": up}, "display_name": "Films", **({"alerts": alerts} if alerts else {})}
        return {watcher.key(r): watcher.snapshot(r)}

    def kinds(self, alerts):
        prev, pending, got = self.rows(alerts, True), {}, []
        for _ in range(watcher.CONFIRM_RUNS):
            ev, pending = watcher.diff(prev, self.rows(alerts, False), pending)
            got += ev
        return sorted(e["kind"] for e in got), got

    def test_levels(self):
        kinds, got = self.kinds(None)
        self.assertIn("panne", kinds)
        self.assertIn("ui_hors", kinds)
        self.assertEqual(got[0]["label"], "Films")   # the name set by hand
        self.assertEqual(self.kinds("down")[0], ["panne"])
        self.assertEqual(self.kinds("none")[0], [])


if __name__ == "__main__":
    unittest.main()
