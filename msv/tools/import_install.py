#!/usr/bin/env python3
"""Import d'une installation classique (systemd) vers le volume /config de la version Docker.

  sudo python3 -m msv.tools.import_install --to ./dev-data/config [--from /opt/myservices] [options]

Repris : config.json, services-meta.json, backups-meta.json, alias SSH et clés qu'ils utilisent,
known_hosts, fichiers de secrets (Veeam, Home Assistant). Pas l'historique (la v2 repart à zéro).
Transformé pour le conteneur :
  - "ssh": "local" (la collectrice) -> alias SSH « hote » vers l'IP de la machine : le conteneur
    n'a pas le socket Docker, il lit sa machine hôte par SSH comme les autres ;
  - NPM par npm-api.sh -> API directe de NPM (URL, compte et mot de passe repris de npm-api.conf) ;
  - chemins (web_dir, cache_dir, state_dir, meta…) retirés : fixés par l'image ;
  - IdentityFile et secrets -> copies dans le volume, chemins réécrits.
L'installation d'origine n'est ni modifiée ni arrêtée. Rien n'est écrasé sans --force.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HOST_ALIAS = "hote"
DROP = ("web_dir", "cache_dir", "state_dir", "meta", "backups_meta", "sshlist")
UID = 10001  # compte myservices de l'image


def say(msg: str) -> None:
    print(f"  {msg}")


def host_ip() -> str:
    """IP LAN de cette machine (route par défaut)."""
    w = subprocess.run(["ip", "-4", "route", "show", "default"], capture_output=True, text=True).stdout.split()
    dev = w[w.index("dev") + 1] if "dev" in w else ""
    a = subprocess.run(["ip", "-4", "-o", "addr", "show", "dev", dev, "scope", "global"],
                       capture_output=True, text=True).stdout.split()
    return a[3].split("/")[0] if len(a) > 3 else ""


def read_conf(path: Path) -> dict:
    """KEY=valeur (npm-api.conf, fichiers de secrets), guillemets retirés."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        k, sep, v = line.partition("=")
        if sep and not k.strip().startswith("#"):
            out[k.strip()] = v.strip().strip("\"'")
    return out


def npm_direct(inst: dict, host: str) -> dict:
    """Instance « api » (npm-api.sh) -> instance « url » (API directe), d'après son npm-api.conf."""
    conf = read_conf(Path(inst["api"]).parent / "npm-api.conf")
    ip = conf.get("NGINX_IP") or "127.0.0.1"
    out = {"name": inst.get("name", "NPM"), "url": f"http://{ip}:{conf.get('NGINX_PORT') or '81'}",
           "user": conf.get("API_USER", ""), "password": conf.get("API_PASS", "")}
    # Réseau de l'hôte : 127.0.0.1 est bien la machine hôte, mais le contrôle DNS attend son IP LAN
    out["ip"] = inst.get("ip") or (host if ip.startswith("127.") else ip)
    if not (out["user"] and out["password"]):
        say(f"⚠ NPM {out['name']} : API_USER / API_PASS absents de npm-api.conf, à compléter dans config.json")
    return out


def convert_config(cfg: dict, host: str, public_url: str | None, no_alerts: bool) -> dict:
    cfg = {k: v for k, v in cfg.items() if k not in DROP}
    npm = cfg.pop("npm", [])
    if cfg.get("npm_api"):  # ancien format : une instance npm-api.sh
        npm.append({"name": "NPM", "api": cfg["npm_api"]})
    cfg.pop("npm_api", None)
    out = []
    for inst in npm:
        if inst.get("api"):
            try:
                inst = npm_direct(inst, host)
                say(f"✓ NPM {inst['name']} : npm-api.sh -> API directe {inst['url']}")
            except OSError as e:
                say(f"⚠ NPM {inst.get('name')} : npm-api.conf illisible ({e}), instance ignorée")
                continue
        out.append(inst)
    if out:
        cfg["npm"] = out
    if public_url:
        cfg["public_url"] = public_url
    if no_alerts:
        for k in ("discord_webhook", "health_webhook", "telegram_token", "telegram_chat_id"):
            cfg.pop(k, None)
        say("✓ alertes Discord / Telegram retirées (--no-alerts)")
    return cfg


def convert_meta(meta: dict) -> int:
    """"local" -> alias de l'hôte, dans machines (ssh, health) et process_hosts. Renvoie le nombre."""
    n = 0
    for m in meta.get("machines", {}).values():
        for k in ("ssh", "health"):
            if m.get(k) == "local":
                m[k] = HOST_ALIAS
                n += 1
    for ip, alias in list(meta.get("process_hosts", {}).items()):
        if alias == "local":
            meta["process_hosts"][ip] = HOST_ALIAS
            n += 1
    return n


def copy_secret(src: str, dest: Path) -> str:
    """Copie un fichier de secrets dans /config/secrets ; renvoie son chemin vu du conteneur."""
    target = dest / "secrets" / Path(src).name.lstrip(".")
    target.parent.mkdir(mode=0o700, exist_ok=True)
    shutil.copyfile(src, target)
    return f"/config/secrets/{target.name}"


def convert_backups(bm: dict, dest: Path) -> None:
    for h in bm.get("hosts", []):
        if h.get("ssh") == "local":
            h["ssh"] = HOST_ALIAS
        if h.get("secrets"):
            try:
                h["secrets"] = copy_secret(h["secrets"], dest)
                say(f"✓ secrets de {h.get('id', '?')} copiés : {h['secrets']}")
            except OSError as e:
                say(f"⚠ secrets de {h.get('id', '?')} illisibles ({e}) : à recopier dans /config/secrets")
        if h.get("mount"):
            say(f"⚠ {h.get('id', '?')} : partage monté {h['mount']} sur la collectrice, à monter aussi dans le conteneur")


def convert_ssh(src: Path, dest: Path, host: str, host_user: str, host_key: str | None) -> list[str]:
    """Recopie ~/.ssh/config (clés réécrites vers ~/.ssh/<nom>, recopiées), known_hosts, et ajoute
    l'alias de la machine hôte. Renvoie les noms des clés copiées."""
    sshd = dest / "ssh"
    sshd.mkdir(mode=0o700, exist_ok=True)  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    keys = []
    text = (src / "config").read_text(encoding="utf-8") if (src / "config").exists() else ""  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed

    def key(m: re.Match) -> str:
        v = m.group(2).strip().strip('"')
        p = src.parent / v[2:] if v.startswith("~/") else Path(v)  # ~ = dossier personnel du compte de --ssh-dir
        if p.exists():
            shutil.copyfile(p, sshd / p.name)
            if p.with_suffix(p.suffix + ".pub").exists():
                shutil.copyfile(p.with_suffix(p.suffix + ".pub"), sshd / (p.name + ".pub"))
            keys.append(p.name)
        else:
            say(f"⚠ clé {p} introuvable : alias qui l'utilisent injoignables")
        return f"{m.group(1)}~/.ssh/{p.name}"
    text = re.sub(r"(?im)^(\s*IdentityFile\s+)(.+)$", key, text)
    if not re.search(rf"(?im)^\s*Host\s+(.*\s)?{HOST_ALIAS}(\s|$)", text):
        ident = f"    IdentityFile ~/.ssh/{host_key}\n    IdentitiesOnly yes\n" if host_key else ""
        text += (f"\n# Machine hôte du conteneur (ajouté par import_install.py) : le conteneur la lit par SSH\n"
                 f"Host {HOST_ALIAS}\n    HostName {host}\n    User {host_user}\n{ident}")
    (sshd / "config").write_text(text, encoding="utf-8")
    if (src / "known_hosts").exists():
        shutil.copyfile(src / "known_hosts", sshd / "known_hosts")
    return sorted(set(keys))


def lock_down(dest: Path, uid: int) -> None:
    """Dossiers 700, fichiers 600 (clés publiques 644), propriétaire = compte de l'image. ACL retirées :
    une ACL par défaut du dossier parent serait héritée par les fichiers créés ensuite (secrets lisibles)."""
    if shutil.which("setfacl"):
        subprocess.run(["setfacl", "-R", "-b", str(dest)], capture_output=True)  # NOSONAR S8705: command-line tool, the paths are the ones its operator typed
    for p in [dest, *dest.rglob("*")]:
        p.chmod(0o700 if p.is_dir() else 0o644 if p.name.endswith(".pub") else 0o600)
        if os.geteuid() == 0:
            os.chown(p, uid, uid)  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--from", dest="src", default=str(Path(__file__).resolve().parents[2]),
                    help="dossier de l'installation classique (config.json, services-meta.json)")
    ap.add_argument("--to", required=True, help="dossier monté en /config dans le conteneur")
    ap.add_argument("--ssh-dir", default=str(Path.home() / ".ssh"), help="~/.ssh du compte du collecteur")
    ap.add_argument("--host-ip", default="", help="IP LAN de la machine hôte (défaut : route par défaut)")
    ap.add_argument("--host-user", default="root", help="compte SSH sur la machine hôte (défaut : root)")
    ap.add_argument("--host-key", default="myservices",
                    help="clé de l'alias hôte (défaut : myservices, la clé que le conteneur crée à son premier démarrage)")
    ap.add_argument("--public-url", default="", help="URL de la page v2 (lien des alertes)")
    ap.add_argument("--no-alerts", action="store_true", help="retirer webhooks Discord et bot Telegram")
    ap.add_argument("--uid", type=int, default=UID, help=f"propriétaire des fichiers (défaut {UID}, compte de l'image)")
    ap.add_argument("--force", action="store_true", help="écraser un dossier --to déjà rempli")
    a = ap.parse_args()

    src, dest, sshd = Path(a.src), Path(a.to), Path(a.ssh_dir)
    if not (src / "config.json").exists() or not (src / "services-meta.json").exists():
        sys.exit(f"{src} : config.json ou services-meta.json absent, pas une installation MyServices")
    if dest.exists() and any(dest.iterdir()) and not a.force:
        sys.exit(f"{dest} n'est pas vide (--force pour écraser)")
    host = a.host_ip or host_ip()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        sys.exit("IP de la machine hôte introuvable : --host-ip")
    dest.mkdir(parents=True, exist_ok=True)  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    print(f"== Import {src} -> {dest} (machine hôte {host}, alias SSH « {HOST_ALIAS} »)")

    cfg = convert_config(json.loads((src / "config.json").read_text(encoding="utf-8")), host, a.public_url, a.no_alerts)  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    (dest / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    meta = json.loads((src / "services-meta.json").read_text(encoding="utf-8"))  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    n = convert_meta(meta)
    (dest / "services-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S2083,S8707: command-line tool, the paths are the ones its operator typed
    say(f"✓ services-meta.json : {len(meta.get('machines', {}))} machines, {n} accès « local » -> « {HOST_ALIAS} »")
    if (src / "backups-meta.json").exists():
        bm = json.loads((src / "backups-meta.json").read_text(encoding="utf-8"))  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
        convert_backups(bm, dest)
        (dest / "backups-meta.json").write_text(json.dumps(bm, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S2083,S8707: command-line tool, the paths are the ones its operator typed
        say(f"✓ backups-meta.json : {len(bm.get('sets', []))} jeux")
    if sshd.is_dir():
        keys = convert_ssh(sshd, dest, host, a.host_user, a.host_key or None)
        say(f"✓ SSH : alias et known_hosts repris, clés copiées : {', '.join(keys) or 'aucune'}")
    else:
        say(f"⚠ {sshd} absent : aucun alias SSH repris")
    lock_down(dest, a.uid)
    print(f"\nFait. La machine hôte est lue par l'alias « {HOST_ALIAS} » ({a.host_user}@{host}). Au premier démarrage, le\n"
          "conteneur crée sa clé (/config/ssh/myservices) et affiche dans son journal la commande qui l'autorise sur\n"
          "l'hôte ; ensuite : docker compose exec myservices python3 -m msv.machines.setup --check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
