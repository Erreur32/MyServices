"""Comptes et sessions (auth.py, api.py) : connexion, refus, limite d'échecs, CSRF, rôles, déconnexion,
jeton jamais stocké en clair, redirection vers la page de connexion.

  À lancer dans l'image (argon2, FastAPI) : python3 -m unittest discover -s tests
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    import api
    from msv.core import auth
    import server
except ImportError:
    api = None

PW = "un mot de passe long"


@unittest.skipIf(api is None, "argon2 / FastAPI absents : tests à lancer dans l'image")
class Accounts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "index.html").write_text("<p>page</p>")
        (d / "v2").mkdir(exist_ok=True)
        (d / "v2" / "index.html").write_text("<p>page</p>")   # the compiled front, served at the root
        (d / "login.html").write_text("<form>")
        server.STATIC = server.WEB = d
        server.PROGRESS = str(d / "progress.json")
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.STORE.create_user("admin", PW, "admin")
        api.STORE.create_user("lecteur", PW, "viewer")
        self.c = TestClient(api.app, client=("192.168.1.20", 50000))

    def tearDown(self):
        self.tmp.cleanup()

    def login(self, user="admin", pw=PW, c=None):
        return (c or self.c).post("/myservices/api/v1/login", json={"username": user, "password": pw})

    def test_redirect_then_login(self):
        r = self.c.get("/", follow_redirects=False)
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/login.html?next=/"))
        self.assertEqual(self.c.get("/api/v1/status").status_code, 401)
        self.assertEqual(self.c.get("/myservices/api/v1/status").status_code, 401)   # the old address answers the same, through the alias
        self.assertEqual(self.c.get("/login.html").status_code, 200)  # public page
        r = self.c.get("/myservices/v2/", follow_redirects=False)                    # an old bookmark leads to the root, then to the sign-in page
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/"))
        r = self.login()
        self.assertEqual((r.status_code, r.json()["role"]), (200, "admin"))
        cookie = r.headers.get_list("set-cookie")
        self.assertTrue(any(c.startswith("ms_session=") and "HttpOnly" in c and "SameSite=strict" in c for c in cookie))
        self.assertTrue(any(c.startswith("ms_csrf=") and "HttpOnly" not in c for c in cookie))
        self.assertEqual(self.c.get("/myservices/index.html").text, "<p>page</p>")
        self.assertEqual(self.c.get("/myservices/api/v1/me").json()["username"], "admin")

    def test_wrong_password_and_unknown_user(self):
        self.assertEqual(self.login(pw="mauvais mot de passe").status_code, 401)
        self.assertEqual(self.login(user="personne").status_code, 401)
        self.assertEqual(self.login(user="personne").json()["error"], "compte ou mot de passe incorrect")

    def test_lockout_after_failures(self):
        for _ in range(auth.LOGIN_MAX_FAIL):
            self.login(pw="faux faux faux faux")
        r = self.login()  # même le bon mot de passe est refusé pendant la fenêtre
        self.assertEqual(r.status_code, 429)
        other = TestClient(api.app, client=("192.168.1.21", 50000))
        self.assertEqual(self.login(c=other).status_code, 200)  # une autre IP n'est pas bloquée

    def test_csrf_required_for_writes(self):
        self.login()
        server.TASKS["collect"]["trigger"] = server.time.time()
        self.assertEqual(self.c.post("/myservices/api/v1/refresh").status_code, 403)
        self.assertEqual(self.c.post("/myservices/api/v1/refresh", headers={"X-CSRF-Token": "faux"}).status_code, 403)
        ok = self.c.post("/myservices/api/v1/refresh", headers={"X-CSRF-Token": self.c.cookies["ms_csrf"]})
        self.assertEqual(ok.status_code, 429)  # passé le contrôle CSRF : refusé seulement par le délai

    def test_roles(self):
        self.login("lecteur")
        self.assertEqual(self.c.get("/myservices/api/v1/users").status_code, 403)
        self.assertEqual(self.c.get("/myservices/api/v1/audit").status_code, 403)
        admin = TestClient(api.app, client=("192.168.1.22", 50000))
        self.login(c=admin)
        names = [u["username"] for u in admin.get("/myservices/api/v1/users").json()["users"]]
        self.assertEqual(names, ["admin", "lecteur"])
        actions = [a["action"] for a in admin.get("/myservices/api/v1/audit").json()["audit"]]
        self.assertIn("connexion", actions)

    def test_logout_and_token_hashed(self):
        r = self.login()
        token = self.c.cookies["ms_session"]
        db = sqlite3.connect(api.STORE.path)
        rows = db.execute("SELECT token_hash FROM sessions").fetchall()
        db.close()
        self.assertNotIn(token, [x[0] for x in rows])  # seule l'empreinte est en base
        self.assertEqual(r.status_code, 200)
        self.c.post("/myservices/api/v1/logout", headers={"X-CSRF-Token": self.c.cookies["ms_csrf"]})
        self.c.cookies.set("ms_session", token, path="/myservices")  # jeton rejoué après déconnexion
        self.assertEqual(self.c.get("/myservices/api/v1/me").status_code, 401)

    def test_password_change_closes_sessions(self):
        self.login()
        h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        self.assertEqual(self.c.post("/myservices/api/v1/me/password", json={"current": "faux", "new": "x" * 12}, headers=h).status_code, 401)
        self.assertEqual(self.c.post("/myservices/api/v1/me/password", json={"current": PW, "new": "court"}, headers=h).status_code, 400)
        r = self.c.post("/myservices/api/v1/me/password", json={"current": PW, "new": "nouveau mot de passe"}, headers=h)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/myservices/api/v1/me").status_code, 401)
        self.assertEqual(self.login(pw="nouveau mot de passe").status_code, 200)

    def test_mes_sessions_et_fermeture_des_autres(self):
        """Un lecteur voit ses sessions (la sienne marquée), ferme les autres appareils sans perdre la sienne."""
        other = TestClient(api.app, client=("192.168.1.21", 50000))
        self.assertEqual(self.login("lecteur", c=other).status_code, 200)
        self.login("lecteur")
        got = self.c.get("/myservices/api/v1/me/sessions").json()
        self.assertEqual([x["current"] for x in got["sessions"]].count(True), 1)
        self.assertEqual(len(got["sessions"]), 2)
        self.assertNotIn("token_hash", got["sessions"][0])
        r = self.c.post("/myservices/api/v1/me/sessions/revoke-others", headers={"X-CSRF-Token": self.c.cookies["ms_csrf"]})
        self.assertEqual((r.status_code, r.json()["closed"]), (200, 1))
        self.assertEqual(self.c.get("/myservices/api/v1/me").status_code, 200)
        self.assertEqual(other.get("/myservices/api/v1/me").status_code, 401)

    def test_duree_des_sessions_bornee(self):
        old = auth.SESSION_DAYS
        self.addCleanup(setattr, auth, "SESSION_DAYS", old)
        auth.set_session_days(30)
        self.assertEqual(auth.SESSION_DAYS, 30)
        for bad in (0, 91, -1):
            with self.assertRaises(auth.AuthError):
                auth.set_session_days(bad)
        c, h = self.admin()
        self.assertEqual(c.put("/myservices/api/v1/security/session-days", json={"days": 500}, headers=h).status_code, 400)
        self.assertEqual(self.login("lecteur", c=TestClient(api.app, client=("192.168.1.22", 1))).status_code, 200)

    def test_viewer_ne_regle_pas_la_duree(self):
        self.login("lecteur")
        r = self.c.put("/myservices/api/v1/security/session-days", json={"days": 30}, headers={"X-CSRF-Token": self.c.cookies["ms_csrf"]})
        self.assertEqual(r.status_code, 403)

    def test_password_change_rate_limited(self):
        self.login()
        h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        for _ in range(auth.LOGIN_MAX_FAIL):
            self.c.post("/myservices/api/v1/me/password", json={"current": "faux faux faux", "new": "x" * 12}, headers=h)
        r = self.c.post("/myservices/api/v1/me/password", json={"current": PW, "new": "nouveau mot de passe"}, headers=h)
        self.assertEqual(r.status_code, 429)

    def admin(self):
        """Client admin connecté et ses en-têtes d'écriture."""
        self.login()
        return self.c, {"X-CSRF-Token": self.c.cookies["ms_csrf"]}

    def test_admin_manages_accounts(self):
        c, h = self.admin()
        u = "/myservices/api/v1/users"
        self.assertEqual(c.post(u, json={"username": "bob", "password": "court"}, headers=h).status_code, 400)
        self.assertEqual(c.post(u, json={"username": "bob", "password": PW, "role": "root"}, headers=h).status_code, 422)
        self.assertEqual(c.post(u, json={"username": "bob", "password": PW}, headers=h).status_code, 200)
        roles = {x["username"]: x["role"] for x in c.get(u).json()["users"]}
        self.assertEqual(roles["bob"], "viewer")  # rôle par défaut : lecture
        self.assertEqual(c.patch(u + "/bob", json={"role": "admin"}, headers=h).status_code, 200)
        self.assertEqual(c.post(u + "/bob/password", json={"password": "autre mot de passe"}, headers=h).status_code, 200)
        bob = TestClient(api.app, client=("192.168.1.23", 50000))
        self.assertEqual(self.login("bob", "autre mot de passe", c=bob).json()["role"], "admin")
        # désactivé : sa session tombe et il ne peut plus se connecter
        self.assertEqual(c.patch(u + "/bob", json={"disabled": True}, headers=h).status_code, 200)
        self.assertEqual(bob.get("/myservices/api/v1/me").status_code, 401)
        self.assertEqual(self.login("bob", "autre mot de passe", c=bob).status_code, 401)
        self.assertEqual(c.patch(u + "/bob", json={"disabled": False}, headers=h).status_code, 200)
        self.assertEqual(c.delete(u + "/bob", headers=h).status_code, 200)
        self.assertEqual(c.delete(u + "/bob", headers=h).status_code, 400)  # déjà supprimé
        actions = [a["action"] for a in api.STORE.audit_log()]
        for a in ("compte créé", "compte modifié", "mot de passe changé (admin)", "compte supprimé"):
            self.assertIn(a, actions)

    def test_admin_cannot_touch_own_account(self):
        c, h = self.admin()
        for r in (c.patch("/myservices/api/v1/users/admin", json={"role": "viewer"}, headers=h),
                  c.patch("/myservices/api/v1/users/ADMIN", json={"disabled": True}, headers=h),
                  c.post("/myservices/api/v1/users/admin/password", json={"password": PW}, headers=h),
                  c.delete("/myservices/api/v1/users/admin", headers=h)):
            self.assertEqual(r.status_code, 400)
        self.assertEqual(c.get("/myservices/api/v1/me").json()["role"], "admin")

    def test_viewer_cannot_manage_accounts(self):
        self.login("lecteur")
        h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        self.assertEqual(self.c.post("/myservices/api/v1/users", json={"username": "x1", "password": PW}, headers=h).status_code, 403)
        self.assertEqual(self.c.patch("/myservices/api/v1/users/admin", json={"disabled": True}, headers=h).status_code, 403)
        self.assertEqual(self.c.delete("/myservices/api/v1/users/admin", headers=h).status_code, 403)
        self.assertEqual(self.c.patch("/myservices/api/v1/users/admin", json={"disabled": True}).status_code, 403)  # sans CSRF

    def test_last_admin_kept(self):
        with self.assertRaises(auth.AuthError):
            api.STORE.update_user("admin", role="viewer")
        with self.assertRaises(auth.AuthError):
            api.STORE.update_user("admin", disabled=True)
        api.STORE.create_user("admin2", PW, "admin")
        api.STORE.update_user("admin2", disabled=True)  # un admin désactivé ne compte pas
        with self.assertRaises(auth.AuthError):
            api.STORE.update_user("admin", role="viewer")
        api.STORE.delete_user("admin2")  # supprimer un admin désactivé reste possible
        api.STORE.create_user("admin3", PW, "admin")
        api.STORE.update_user("admin", role="viewer")  # un autre admin actif existe : permis

    def test_store_rules(self):
        with self.assertRaises(auth.AuthError):
            api.STORE.create_user("x y", PW, "viewer")
        with self.assertRaises(auth.AuthError):
            api.STORE.create_user("autre", "court", "viewer")
        with self.assertRaises(auth.AuthError):
            api.STORE.create_user("ADMIN", PW, "viewer")  # nom déjà pris (sans tenir compte de la casse)
        with self.assertRaises(auth.AuthError):
            api.STORE.delete_user("admin")  # dernier admin


@unittest.skipIf(api is None, "argon2 / FastAPI absents : tests à lancer dans l'image")
class FirstAccount(unittest.TestCase):
    """Première installation : aucun compte, la page de connexion crée le compte admin."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "index.html").write_text("<p>page</p>")
        (d / "v2").mkdir(exist_ok=True)
        (d / "v2" / "index.html").write_text("<p>page</p>")   # the compiled front, served at the root
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.STARTED = server.time.time()
        self.c = TestClient(api.app, client=("192.168.1.30", 50000))

    def tearDown(self):
        self.tmp.cleanup()

    def setup(self, user="moi", pw=PW, c=None):
        return (c or self.c).post("/myservices/api/v1/setup", json={"username": user, "password": pw})

    def test_create_then_closed(self):
        st = self.c.get("/myservices/api/v1/setup").json()
        self.assertTrue(st["needed"])
        self.assertGreater(st["seconds_left"], 0)
        self.assertEqual(self.setup(pw="court").status_code, 400)  # mêmes règles qu'un compte normal
        r = self.setup()
        self.assertEqual((r.status_code, r.json()["role"]), (200, "admin"))
        self.assertEqual(self.c.get("/myservices/api/v1/me").json()["username"], "moi")  # connecté d'emblée
        self.assertFalse(self.c.get("/myservices/api/v1/setup").json()["needed"])
        other = TestClient(api.app, client=("192.168.1.31", 50000))
        self.assertEqual(self.setup("intrus", c=other).status_code, 409)  # fermé dès que le compte existe
        self.assertEqual([u["username"] for u in api.STORE.users()], ["moi"])
        self.assertIn("premier compte admin créé (page)", [a["action"] for a in api.STORE.audit_log()])

    def test_window_expired(self):
        api.STARTED = server.time.time() - api.SETUP_WINDOW - 1
        self.assertEqual(self.c.get("/myservices/api/v1/setup").json()["seconds_left"], 0)
        r = self.setup()
        self.assertEqual(r.status_code, 403)
        self.assertIn("redémarrer le conteneur", r.json()["error"])
        self.assertFalse(api.STORE.has_users())

    def test_outside_lan_refused(self):
        outside = TestClient(api.app, client=("8.8.8.8", 50000))
        self.assertEqual(self.setup(c=outside).status_code, 403)
        self.assertFalse(api.STORE.has_users())

    def test_only_one_admin_even_if_concurrent(self):
        self.assertTrue(api.STORE.create_first_admin("a1", PW))
        self.assertFalse(api.STORE.create_first_admin("a2", PW))
        self.assertEqual([u["username"] for u in api.STORE.users()], ["a1"])


if __name__ == "__main__":
    unittest.main()
