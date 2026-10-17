"""hostinfo.parse_nginx and myservices.attach_vhost_domains: domains declared by nginx / Apache are attached to the local row of their port.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402

import hostinfo  # noqa: E402
from unittest import mock  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only (the global config is left as it was)
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402

OUT = """##OS Debian
##F /etc/apache2/sites-enabled/a.conf
<VirtualHost *:8080>
ServerName apache.example.org
##NF /etc/nginx/sites-enabled/site
server {
    listen 80;
    listen [::]:80;
    server_name www.example.org example.org _;
}
server {
    listen 443 ssl;
    server_name *.wild.example.org ~^re.*$ app.example.org;
}
##NF /etc/nginx/conf.d/plain.conf
server {
    server_name noport.example.org;
}
##NU /etc/nginx/conf.d/secret.conf
"""


class Nginx(unittest.TestCase):
    def test_parse(self):
        vhosts, unreadable = hostinfo.parse_nginx(OUT)
        got = {(v["port"], tuple(v["names"])) for v in vhosts}
        self.assertEqual(got, {(80, ("www.example.org", "example.org")), (443, ("app.example.org",)), (80, ("noport.example.org",))})
        self.assertEqual(unreadable, ["secret.conf"])

    def test_apache_unaffected(self):
        vhosts, *_ = hostinfo.parse_apache(OUT)
        self.assertEqual([(v["port"], v["names"]) for v in vhosts], [(8080, ["apache.example.org"])])

    def test_attach(self):
        rows = [{"type": "local", "ip": "10.0.0.2", "port": 80}, {"type": "proxy", "ip": "10.0.0.2", "port": 80, "domains": ["x"]}]
        myservices.attach_vhost_domains(rows, {"10.0.0.2": {"nginx_vhosts": [{"port": 80, "names": ["a.org", "b.org"], "conf": "s"}], "vhosts": []}})
        self.assertEqual(rows[0]["vhost_domains"], ["a.org", "b.org"])
        self.assertEqual(rows[0]["vhost_server"], "nginx")
        self.assertNotIn("vhost_domains", rows[1])


if __name__ == "__main__":
    unittest.main()
