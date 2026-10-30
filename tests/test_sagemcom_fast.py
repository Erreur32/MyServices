"""connectors/sagemcom_fast.py: the reading of the JSON interface of a Sagemcom F@st against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import hashlib
import json
import unittest

from connectors.base import ConnectorError, Context, RateLimited
from connectors.sagemcom_fast import SagemcomFast, count_active, key, pick

BASE = "http://192.168.1.1"
USER = "admin"
SECRET = "".join(("pw", "-", "unit", "-", "test"))   # built at run time: no secret-looking literal
NONCE = "98765"


def reply(description="XMO_REQUEST_NO_ERR", actions=None) -> dict:
    return {"reply": {"uid": 0, "id": 1, "error": {"code": 16777238, "description": description}, "actions": actions or []}}


def action(index: int, params: dict | None = None, error="XMO_NO_ERR") -> dict:
    return {"uid": index, "id": index, "error": {"code": 0, "description": error}, "callbacks": [{"uid": 1, "result": {"code": 0, "description": "XMO_NO_ERR"}, "parameters": params or {}}]}


LOGIN = reply(actions=[action(0, {"id": 1234, "nonce": NONCE})])
INFO = {"DeviceInfo": {"MACAddress": "00:11:22:33:44:55", "SerialNumber": "SECRETSERIAL", "ModelNumber": "F@st3890", "SoftwareVersion": "SG_BELL_1.2.3", "UpTime": 5000}}
HOSTS = [{"Host": {"Active": True, "PhysAddress": "aa:bb"}}, {"Host": {"Active": False}}, {"Host": {"Active": True}}]
READ = reply("XMO_REQUEST_NO_ERR", [action(0, {"value": INFO}), action(1, {"value": HOSTS})])
LOGOUT = reply()


class FakeContext(Context):
    """Answers the requests in order (login, read, logout); a ConnectorError in the list is raised."""

    def __init__(self, answers: list):
        super().__init__()
        self.answers, self.sent, self.calls = list(answers), [], []

    def http(self, url, *, method="GET", form=None, **kw):
        self.calls.append((method, url))
        self.sent.append(json.loads(form["req"])["request"] if form else None)
        if not self.answers:
            raise ConnectorError("HTTP 404")
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def box(ctx, **over) -> SagemcomFast:
    return SagemcomFast({"type": "sagemcom-fast", "name": "box", "url": BASE, "username": USER, "password": SECRET, "encryption": "SHA512", **over}, ctx)


class Helpers(unittest.TestCase):
    def test_names_and_picking(self):
        self.assertEqual((key("UpTime"), key("up_time"), pick({"model_name": "x"}, "ModelName"), pick({"a": ""}, "a"), pick(None, "a")), ("uptime", "uptime", "x", None, None))

    def test_active_devices(self):
        self.assertEqual((count_active(HOSTS), count_active([{"Active": True}]), count_active({"Hosts": HOSTS}), count_active(None), count_active([])), (2, 1, 2, None, 0))


class Reading(unittest.TestCase):
    def test_full_reading_and_the_requests_sent(self):
        ctx = FakeContext([LOGIN, READ, LOGOUT])
        d = box(ctx).collect()
        self.assertEqual(d["box"], {"model": "F@st3890", "line": None, "connected": None, "down_bps": None, "up_bps": None, "line_down_bps": None, "line_up_bps": None,
                                    "public_ip": None, "uptime_s": None, "firmware": "SG_BELL_1.2.3", "update_available": None, "latest_firmware": None,
                                    "devices": 2, "wifi": None, "temperature": None})
        self.assertNotIn("SECRETSERIAL", str(d))
        self.assertNotIn("00:11:22", str(d))
        self.assertTrue(all(c == ("POST", BASE + "/cgi/json-req") for c in ctx.calls))
        self.assertEqual([[a["method"] for a in r["actions"]] for r in ctx.sent], [["logIn"], ["getValue", "getValue"], ["logOut"]])
        self.assertEqual([r["actions"][0].get("xpath") for r in ctx.sent[1:2]], ["Device/DeviceInfo"])
        self.assertNotIn(SECRET, json.dumps(ctx.sent), "the password is never sent, only its hashes")

    def test_the_auth_key_follows_the_library(self):
        ctx = FakeContext([LOGIN, READ, LOGOUT])
        box(ctx).collect()

        def sha(s):
            return hashlib.sha512(s.encode()).hexdigest()
        for n, nonce in ((0, ""), (1, NONCE)):   # the login has no server nonce yet
            r = ctx.sent[n]
            credential = sha(f"{USER}:{nonce}:{sha(SECRET)}")
            self.assertEqual((r["id"], r["auth-key"]), (n, sha(f"{credential}:{n}:{r['cnonce']}:JSON:/cgi/json-req")))
        self.assertEqual((ctx.sent[0]["session-id"], ctx.sent[1]["session-id"]), (0, 1234))

    def test_md5_encryption(self):
        ctx = FakeContext([LOGIN, READ, LOGOUT])
        box(ctx, encryption="MD5").collect()
        r = ctx.sent[0]
        credential = hashlib.md5(f"{USER}::{hashlib.md5(SECRET.encode()).hexdigest()}".encode()).hexdigest()
        self.assertEqual(r["auth-key"], hashlib.md5(f"{credential}:0:{r['cnonce']}:JSON:/cgi/json-req".encode()).hexdigest())

    def test_unknown_encryption_is_an_error_before_any_call(self):
        ctx = FakeContext([])
        with self.assertRaises(ConnectorError):
            box(ctx, encryption="NONE").collect()
        self.assertEqual(ctx.calls, [])

    def test_hosts_are_optional(self):
        ctx = FakeContext([LOGIN, reply("XMO_REQUEST_ACTION_ERR", [action(0, {"value": INFO}), action(1, error="XMO_UNKNOWN_PATH_ERR")]), LOGOUT])
        b = box(ctx).collect()["box"]
        self.assertEqual((b["model"], b["devices"]), ("F@st3890", None))

    def test_a_flat_device_info_and_the_model_fallback(self):
        flat = {"ProductClass": "BoxX", "ExternalFirmwareVersion": "9.9"}
        d = box(FakeContext([LOGIN, reply(actions=[action(0, {"value": flat}), action(1, {"value": []})]), LOGOUT])).collect()
        self.assertEqual((d["box"]["model"], d["box"]["firmware"], d["box"]["devices"]), ("BoxX", "9.9", 0))

    def test_the_device_info_refused_is_an_error(self):
        with self.assertRaises(ConnectorError):
            box(FakeContext([LOGIN, reply("XMO_REQUEST_ACTION_ERR", [action(0, error="XMO_UNKNOWN_PATH_ERR"), action(1)]), LOGOUT])).collect()


class Failures(unittest.TestCase):
    def refused(self, answers, **over):
        ctx = FakeContext(answers)
        with self.assertRaises(ConnectorError) as cm:
            box(ctx, **over).collect()
        for secret in (SECRET, hashlib.sha512(SECRET.encode()).hexdigest()):
            self.assertNotIn(secret, str(cm.exception))
        return cm.exception, ctx

    def test_a_refused_login_stops_at_the_first_call(self):
        _, ctx = self.refused([reply("XMO_AUTHENTICATION_ERR"), READ, LOGOUT])
        self.assertEqual(len(ctx.calls), 1, "no retry, no logout, no other encryption")

    def test_a_login_without_a_session_is_a_refusal(self):
        e, ctx = self.refused([reply(actions=[action(0, {})]), LOGOUT])
        self.assertIn("refusé", str(e))
        self.assertEqual(len(ctx.calls), 1)

    def test_locked_and_busy_boxes(self):
        self.assertIn("bloque", str(self.refused([reply("XMO_LOGIN_RETRY_ERR")])[0]))
        self.assertIn("sessions", str(self.refused([reply("XMO_MAX_SESSION_COUNT_ERR")])[0]))

    def test_a_logout_is_sent_even_when_the_read_fails(self):
        _, ctx = self.refused([LOGIN, reply("XMO_AUTHENTICATION_ERR"), LOGOUT])
        self.assertEqual([r["actions"][0]["method"] for r in ctx.sent], ["logIn", "getValue", "logOut"])

    def test_a_failed_logout_does_not_hide_the_reading(self):
        self.assertEqual(box(FakeContext([LOGIN, READ, ConnectorError("injoignable")])).collect()["box"]["devices"], 2)

    def test_not_a_sagemcom(self):
        self.assertIn("Sagemcom", str(self.refused([ConnectorError("HTTP 404")])[0]))
        self.assertIn("illisible", str(self.refused([{"hello": "world"}])[0]))
        self.refused([None])

    def test_rate_limit_is_kept(self):
        with self.assertRaises(RateLimited):
            box(FakeContext([RateLimited("HTTP 429", 5)])).collect()

    def test_the_test_button_shows_no_secret(self):
        r = box(FakeContext([LOGIN, READ, LOGOUT])).test()
        self.assertTrue(r.ok)
        for secret in (SECRET, USER, "SECRETSERIAL"):
            self.assertNotIn(secret, r.message)
        r = box(FakeContext([reply("XMO_AUTHENTICATION_ERR")])).test()
        self.assertFalse(r.ok)
        self.assertNotIn(SECRET, r.message)


class Fields(unittest.TestCase):
    def test_the_password_is_the_only_secret(self):
        self.assertEqual([f.name for f in SagemcomFast.fields if f.secret], ["password"])
        self.assertEqual(SagemcomFast.validate({"url": BASE, "username": USER, "password": SECRET}), [])
        self.assertEqual(len(SagemcomFast.validate({"url": BASE})), 2)
        self.assertNotIn(SECRET, str(SagemcomFast.public({"password": SECRET})))


if __name__ == "__main__":
    unittest.main()
