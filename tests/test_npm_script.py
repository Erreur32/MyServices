"""NPM : modes de lecture (API directe, API par SSH, script npm-api.sh), script lancé par SSH, conseils sur son chemin et installation
(version figée, empreinte vérifiée, mot de passe jamais en ligne de commande), sur de faux « ssh » et « sh ».

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from msv.remote import npmapi  # noqa: E402

try:
    from fastapi.testclient import TestClient

    from msv.api import api
    from msv.api import common
    from msv.core import auth
    from msv.api import server
    from msv.core import tokens
except ImportError:
    api = None
    common = None

NPM = connectors.TYPES["npm"]


class ByAgent(unittest.TestCase):
    INST = {"name": "vps", "agent": "203.0.113.7"}

    def fetch(self, rep):
        with mock.patch("msv.machines.agent_reports.fresh_reports", return_value=rep):
            return npmapi.fetch(self.INST)

    @staticmethod
    def report(cmds):
        return {"203.0.113.7": {"fresh": True, "report": {"data": {"kind": "linux", "cmds": cmds}}}}

    def test_lists_of_the_report(self):
        cmds = {f"npm {opt}": [0, "[]"] for _, opt in npmapi.LISTS.values()}
        cmds["npm --host-list"] = [0, '[{"id": 1}]']
        got = self.fetch(self.report(cmds))
        self.assertEqual(got["hosts"], [{"id": 1}])
        self.assertEqual(set(got), set(npmapi.LISTS))

    def test_errors_say_why(self):
        with self.assertRaisesRegex(npmapi.NPMError, "relevé récent"):
            self.fetch({})
        nothing = self.report({})
        with self.assertRaisesRegex(npmapi.NPMError, "MSV_NPM"):
            self.fetch(nothing)
        bad = self.report({f"npm {opt}": [1, "sudo: a password is required"] for _, opt in npmapi.LISTS.values()})
        with self.assertRaisesRegex(npmapi.NPMError, "password is required"):
            self.fetch(bad)

    def test_mode_needs_only_the_address(self):
        self.assertEqual(NPM.mode_of({"agent": "203.0.113.7"}), "agent")
        self.assertEqual(NPM.validate({"agent": "203.0.113.7"}), [])


class Modes(unittest.TestCase):
    def test_trois_modes_declares_et_champs_connus(self):
        names = {f.name for f in NPM.fields}
        self.assertEqual([m["id"] for m in NPM.modes], ["direct", "ssh", "script", "agent"])
        for m in NPM.modes:
            self.assertTrue(set(m["fields"]) <= names and set(m["required"]) <= set(m["fields"]), m["id"])

    def test_mode_deduit_des_reglages(self):
        self.assertEqual(NPM.mode_of({"url": "http://x"}), "direct")
        self.assertEqual(NPM.mode_of({"url": "http://127.0.0.1:81", "ssh": "nas"}), "ssh")
        self.assertEqual(NPM.mode_of({"api": "/opt/npm-api/npm-api.sh", "ssh": "nas"}), "script")

    def test_validation_selon_le_mode(self):
        self.assertEqual(NPM.validate({"url": "http://x", "user": "a@b", "password": "p"}), [])
        self.assertEqual(NPM.validate({"api": "/opt/npm-api/npm-api.sh"}), [])
        self.assertEqual(NPM.validate({"api": "/opt/npm-api/npm-api.sh", "ssh": "nas"}), [])
        self.assertIn("« Mot de passe NPM » requis", NPM.validate({"url": "http://x", "user": "a@b"}))
        self.assertIn("« Mot de passe NPM » requis", NPM.validate({"url": "http://x", "user": "a@b", "ssh": "nas"}))  # mode SSH : même exigence
        self.assertEqual(len(NPM.validate({})), 3)  # mode direct : url, compte, mot de passe

    def test_schema_expose_les_modes_a_la_page(self):
        from connectors import settings
        npm = next(t for t in settings.schema() if t["type"] == "npm")
        self.assertEqual([m["id"] for m in npm["modes"]], ["direct", "ssh", "script", "agent"])
        adguard = next(t for t in settings.schema() if t["type"] == "adguard")   # its API, or AdGuardHome.yaml over SSH
        self.assertEqual([m["id"] for m in adguard["modes"]], ["direct", "ssh"])
        self.assertTrue(all(not t["modes"] for t in settings.schema() if t["type"] not in ("npm", "adguard", "borgmatic")))


class ScriptParSsh(unittest.TestCase):
    def test_script_lance_sur_la_machine_et_pas_ici(self):
        seen = []

        def fake(argv, **kw):
            seen.append(argv)
            return mock.Mock(returncode=0, stdout="[]", stderr="")
        with mock.patch.object(npmapi.subprocess, "run", fake):
            npmapi._script("/home/u/npm-api/npm-api.sh", "--host-list", "nas")
            npmapi._script("/opt/npm-api/npm-api.sh", "--host-list")
        from msv.remote.sshmux import SSH_MUX
        n = 1 + len(SSH_MUX)
        self.assertEqual(seen[0][:n + 4], ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5"])   # one shared connection per machine
        self.assertEqual(seen[0][n + 4], "nas")
        self.assertIn("--json --host-list", seen[0][n + 5])
        self.assertEqual(seen[1], ["/opt/npm-api/npm-api.sh", "--json", "--host-list"])

    def test_fetch_transmet_la_machine(self):
        with mock.patch.object(npmapi, "_script", return_value=[]) as sc:
            npmapi.fetch({"name": "n", "api": "/x/npm-api.sh", "ssh": "nas"})
        self.assertTrue(all(c.args[2] == "nas" for c in sc.call_args_list))


class Conseils(unittest.TestCase):
    def tips(self, out, code=0, ssh="nas", path="/home/u/npm-api/npm-api.sh"):
        with mock.patch.object(npmapi, "_run_remote", return_value=(code, out)):
            return npmapi.check_script(path, ssh)

    def levels(self, tips):
        return [t["level"] for t in tips]

    def test_tout_est_la(self):
        t = self.tips('EXEC\nCONF\nCURL\nJQ\nNGINX_IP="127.0.0.1"\nNGINX_PORT="81"\nAPI_USER="admin@x"')
        self.assertEqual(self.levels(t), ["ok"] * 5)
        self.assertIn("NPM 127.0.0.1:81, compte admin@x", t[-1]["text"])
        self.assertIn("sur nas", t[0]["text"])

    def test_pas_de_mot_de_passe_dans_les_conseils(self):
        t = self.tips('EXEC\nCONF\nCURL\nJQ\nAPI_USER="a"\nAPI_PASS="secret-factice"')
        self.assertNotIn("secret-factice", str(t))

    def test_script_introuvable_dans_le_conteneur_explique_quoi_faire(self):
        t = self.tips("MISSING", ssh=None, path="/opt/npm-api/npm-api.sh")
        self.assertEqual(self.levels(t), ["bad"])
        self.assertIn("conteneur", t[0]["text"])
        self.assertIn("Installer", t[0]["text"])

    def test_introuvable_sur_la_machine(self):
        t = self.tips("MISSING")
        self.assertIn("Installer npm-api.sh", t[0]["text"])

    def test_non_executable_conf_et_outils_manquants(self):
        self.assertIn("chmod +x", self.tips("NOEXEC")[0]["text"])
        t = self.tips("EXEC\nCURL")
        self.assertEqual(self.levels(t), ["ok", "warn", "ok", "bad"])
        self.assertIn("jq absent", t[3]["text"])

    def test_machine_injoignable(self):
        t = self.tips("ssh: connect to host x port 22: Connection refused", code=255)
        self.assertEqual(self.levels(t), ["bad"])
        self.assertIn("injoignable", t[0]["text"])

    def test_chemin_refuse(self):
        for bad in ("", "/opt/x/autre.sh", "/opt/npm-api/npm-api.sh; rm -rf /", "/opt/ npm-api.sh"):
            self.assertEqual(self.levels(npmapi.check_script(bad, "nas")), ["bad"], bad)


class Installation(unittest.TestCase):
    ARGS = dict(ssh="nas", directory="npm-api", ip="127.0.0.1", port=81, user="admin@example.test", password="-".join(["mdp", "factice", "1"]))

    def run_install(self, out="OK /home/u/npm-api/npm-api.sh\nOK /home/u/npm-api/npm-api.conf", code=0, **over):
        calls = []

        def fake(ssh, script, stdin=None, timeout=60):
            calls.append((ssh, script, stdin))
            return code, out
        with mock.patch.object(npmapi, "_run_remote", fake):
            args = {**self.ARGS, **over}
            return npmapi.install_script(**args), calls

    def test_installe_la_version_figee_et_ecrit_la_conf_par_stdin(self):
        got, calls = self.run_install()
        ssh, script, stdin = calls[0]
        self.assertEqual((got["ok"], got["path"], got["version"]), (True, "/home/u/npm-api/npm-api.sh", npmapi.SCRIPT_VERSION))
        self.assertIn(f"v{npmapi.SCRIPT_VERSION}/npm-api.sh", script)          # le tag, jamais « main »
        self.assertIn(npmapi.SCRIPT_SHA256, script)                              # empreinte vérifiée avant installation
        self.assertNotIn("mdp-factice-1", script)                                # le mot de passe ne figure pas dans la commande
        self.assertTrue(stdin.startswith("npm-api\n"))
        self.assertIn("API_PASS='mdp-factice-1'", stdin)
        self.assertIn("API_USER='admin@example.test'", stdin)
        self.assertEqual(got["lines"], ["✓ /home/u/npm-api/npm-api.sh", "✓ /home/u/npm-api/npm-api.conf"])

    def test_conf_existante_conservee_et_outils_manquants_signales(self):
        got, _ = self.run_install(out="OK /home/u/npm-api/npm-api.sh\nKEEP npm-api.conf existant conservé\nWARN jq absent")
        self.assertEqual(got["lines"][1:], ["= npm-api.conf existant conservé", "⚠ jq absent (apt install curl jq)"])

    def test_guillemet_dans_le_mot_de_passe_est_protege(self):
        _, calls = self.run_install(password="a'b$c`d")
        self.assertIn("API_PASS='a'\\''b$c`d'", calls[0][2])

    def test_echec_lisible(self):
        with self.assertRaises(npmapi.NPMError) as e:
            self.run_install(out="ERR empreinte du script téléchargé différente de celle attendue : rien n'est installé", code=3)
        self.assertIn("empreinte", str(e.exception))
        with self.assertRaises(npmapi.NPMError) as e:
            self.run_install(out="ERR ni curl ni wget sur la machine", code=2)
        self.assertIn("curl", str(e.exception))

    def test_entrees_refusees_avant_toute_connexion(self):
        for over in ({"directory": "../x; rm"}, {"directory": ""}, {"ip": "1.2.3.4; id"}, {"port": 0}, {"port": 70000},
                     {"user": "a b"}, {"user": "a'b"}, {"password": ""}, {"password": "a\nb"}, {"password": "x" * 201}):
            with self.assertRaises(npmapi.NPMError, msg=str(over)):
                self.run_install(**over)

    def test_le_fichier_de_conf_est_relu_tel_quel_par_bash(self):
        """npm-api.sh lit son npm-api.conf avec `source` : on le relit avec un vrai bash, mot de passe piégé compris."""
        import shutil
        import subprocess
        import tempfile
        if not shutil.which("bash"):
            self.skipTest("bash absent")
        pw = "a'b\"c$HOME`id`\\d é"
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "npm-api.conf"
            f.write_text(npmapi.conf_text("192.168.1.10", 81, "admin@example.test", pw), encoding="utf-8")
            out = subprocess.run(["bash", "-c", f'source "{f}"; printf "%s|%s|%s|%s" "$NGINX_IP" "$NGINX_PORT" "$API_USER" "$API_PASS"'],
                                 capture_output=True, text=True, timeout=10).stdout
        self.assertEqual(out, f"192.168.1.10|81|admin@example.test|{pw}")

    def test_conf_au_format_du_modele(self):
        c = npmapi.conf_text("127.0.0.1", 81, "admin@example.test", "mdp-factice-1")
        for line in ("NGINX_IP='127.0.0.1'", "NGINX_PORT='81'", "API_USER='admin@example.test'", "API_PASS='mdp-factice-1'", "# DATA_DIR="):
            self.assertIn(line, c)
        self.assertTrue(c.isascii())  # commentaires en ASCII : aucun risque d'encodage sur la machine

    def test_empreinte_attendue_est_un_sha256(self):
        self.assertRegex(npmapi.SCRIPT_SHA256, r"^[0-9a-f]{64}$")


class ReglagesEtRoutes(unittest.TestCase):
    def test_alias_inconnu_refuse(self):
        from connectors import settings
        with mock.patch("msv.machines.machines_admin.aliases", return_value=[{"alias": "nas"}]):
            with self.assertRaises(settings.SettingsError):
                settings.npm_script_check("/x/npm-api.sh", "pirate.example")
            with mock.patch.object(npmapi, "check_script", return_value=[{"level": "ok", "text": "ok"}]) as ck:
                self.assertTrue(settings.npm_script_check("/x/npm-api.sh", "nas")["ok"])
                self.assertEqual(ck.call_args.args[1], "nas")
                settings.npm_script_check("/x/npm-api.sh", "")
                self.assertIsNone(ck.call_args.args[1])  # vide = dans le conteneur

    def test_installer_exige_une_machine(self):
        from connectors import settings
        with self.assertRaises(settings.SettingsError):
            settings.npm_script_install("", "npm-api", "127.0.0.1", 81, "a", "b")


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Droits(unittest.TestCase):
    def test_installation_refusee_a_un_jeton_d_api_meme_admin(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            server.STATIC = server.WEB = Path(d)
            common.AUTH = True
            common.STORE = auth.Store(Path(d) / "myservices.db")
            common.TOKENS = tokens.Tokens(Path(d) / "myservices.db")
            common.STORE.create_user("admin", "un mot de passe long", "admin")
            c = TestClient(api.app, client=("192.168.1.50", 50000))
            c.post("/myservices/api/v1/login", json={"username": "admin", "password": "un mot de passe long"})
            raw, _ = common.TOKENS.create("api", "ci", "admin", 30, "admin")
            body = {"ssh": "nas", "user": "a@b", "password": "-".join(["mdp", "factice", "1"])}
            url = "/myservices/api/v1/connectors/settings/npm/script/install"
            r = TestClient(api.app, client=("192.168.1.51", 50000)).post(url, json=body, headers={"Authorization": f"Bearer {raw}"})
            self.assertEqual(r.status_code, 403)
            self.assertIn("session requise", r.text)
            r = c.post(url, json={"ssh": "nas"}, headers={"X-CSRF-Token": c.cookies["ms_csrf"]})  # corps incomplet
            self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
