#!/usr/bin/env python3
"""Garde-fou avant commit et avant push : rien de sensible ne part dans l'historique (règle n° 1).

  safety.py --staged          pre-commit : ce qui est indexé
  safety.py --range ARGS…    pre-push, CI : chaque commit de la plage, ARGS passés à git rev-list (A..B, ou SHA --not --remotes)
  safety.py --tree [REF]     arbre complet d'un commit (défaut HEAD) : audit ponctuel
  safety.py --history        tous les commits de toutes les branches

Bloque (code 1) : fichiers de config / secrets / clés / bases / notes privées, clés privées, jetons connus,
mots de passe écrits en dur, URL avec identifiants, et tout motif de `.safety-deny` (local, jamais versionné :
vos vrais noms de domaine, IP, comptes). Toute image (capture d'écran) est bloquée tant qu'elle n'a pas été relue (empreinte dans scripts/images-relues.txt).
Avertit seulement : IP privées hors exemples, binaires.
Une ligne qui contient `safety:allow` est ignorée (faux positif assumé, à justifier dans le commit).
Aucune dépendance : bibliothèque standard.
"""
from __future__ import annotations

import fnmatch
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DENY_FILE = ROOT / ".safety-deny"
IMAGES_OK = ROOT / "scripts" / "images-relues.txt"  # 32 premiers caractères du sha256 des images relues à l'œil (« empreinte  chemin »)
ALLOW_MARK = "safety:allow"
BIG = 500_000  # octets : avertissement

# Chemins qui ne doivent jamais être versionnés (motifs fnmatch sur le chemin complet, insensibles à la casse)
FORBIDDEN = [
    "config.json", "services-meta.json", "backups-meta.json", "*/config.json", "*/services-meta.json",
    "secret.key", "*/secret.key", "*.pem", "*.p12", "*.pfx", "*.key", "id_rsa*", "id_ed25519*", "id_ecdsa*",
    "*/id_rsa*", "*/id_ed25519*", "*/id_ecdsa*", "authorized_keys", "*/authorized_keys", "known_hosts", "*/known_hosts",
    ".env", ".env.*", "*/.env", "*/.env.*", "*.sqlite", "*.sqlite3", "*.db", "*.db-wal", "*.db-shm",
    "dev-data/*", "*ADMIN-mot-de-passe*", "*.htpasswd", "npm-api.conf", "*/npm-api.conf",
    "TODO.md", "PLAN.md", ".notes.git/*", "web/data.json", "web/events.json", "*.bundle", "*.tar.gz", "*.tgz", "*.zip",
]
# Exceptions : les exemples sont faits pour être versionnés
FORBIDDEN_OK = ["*.example.json", "*.example.yaml", "*.example.yml", ".env.example", "*/.env.example"]

SECRETS = [
    (r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----", "clé privée"),
    (r"\bAKIA[0-9A-Z]{16}\b", "clé AWS"),
    (r"\bgh[pousr]_[0-9A-Za-z]{36,}\b", "jeton GitHub"),
    (r"\bgithub_pat_[0-9A-Za-z_]{22,}\b", "jeton GitHub (fin)"),
    (r"\bglpat-[0-9A-Za-z_-]{20,}\b", "jeton GitLab"),
    (r"\bsk-ant-[0-9A-Za-z_-]{20,}\b", "clé Anthropic"),
    (r"\bsk-(?:proj-)?[0-9A-Za-z_-]{40,}\b", "clé OpenAI"),
    (r"\bxox[abprs]-[0-9A-Za-z-]{10,}\b", "jeton Slack"),
    (r"\bAIza[0-9A-Za-z_-]{35}\b", "clé Google"),
    (r"\bmsv_(?:api|mcp)_[0-9A-Za-z_-]{16,}\b", "jeton API / MCP de MyServices"),
    (r"https://(?:discord(?:app)?\.com)/api/webhooks/\d+/[\w-]{20,}", "webhook Discord"),
    (r"\bbot\d{8,10}:[A-Za-z0-9_-]{35}\b", "jeton de bot Telegram"),
    (r"\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b", "jeton de bot Telegram"),
    (r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "JWT"),
    (r"[a-z][a-z0-9+.-]*://[^\s/:@'\"]+:[^\s/@'\"]{3,}@[^\s/'\"]+", "URL avec identifiants"),
    (r"(?i)\b(?:authorization|bearer)[\"']?\s*[:=]?\s*[\"']?bearer\s+[A-Za-z0-9._~+/=-]{20,}", "en-tête Bearer"),
]
# nom = "valeur" écrit en dur
ASSIGN = re.compile(
    r"""(?ix)\b([\w.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key)[\w.-]*)
        ["']?\s*[:=]\s*["']([^"'\s$<{}\[\]()]{8,})["']""")
PLACEHOLDER = re.compile(
    r"(?i)^(?:[/~.][\w./~-]*|x+|\*+|\.+|changeme|change[-_]?me|example|exemple|secret|password|motdepasse|mot-de-passe|none|null|true|false|"
    r"your[-_].*|<.*>|dummy.*|fake.*|test.*|demo.*|todo|redacted|enc:v1:.*)$")
PRIVATE_IP = re.compile(r"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b")
IP_EXAMPLE = re.compile(r"\b(?:10\.0\.0|192\.168\.(?:0|1)|172\.(?:16|30)\.0)\.\d{1,3}\b")  # adresses de documentation courantes
IP_QUIET = ("README", "docs/", "tests/", "fixtures", ".example.", "CHANGELOG", "setup.py", "install.sh", "config.py")

IMAGE = re.compile(r"\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico)$", re.I)

problems: list[str] = []
warnings: list[str] = []
ips: dict[str, set[str]] = {}  # fichier -> IP privées hors adresses d'exemple


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, errors="replace")
    if check and r.returncode:
        sys.exit(f"git {' '.join(args)} : {r.stderr.strip()}")
    return r.stdout


def forbidden(path: str) -> bool:
    low = path.lower()
    if any(fnmatch.fnmatch(low, p.lower()) for p in FORBIDDEN_OK):
        return False
    return any(fnmatch.fnmatch(low, p.lower()) or fnmatch.fnmatch(Path(low).name, p.lower()) for p in FORBIDDEN)


def denylist() -> list[re.Pattern]:
    if not DENY_FILE.exists():
        return []
    out = []
    for ln in DENY_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            out.append(re.compile(ln, re.I))
    return out


DENY = denylist()


def scan_line(where: str, path: str, line: str) -> None:
    if ALLOW_MARK in line or len(line) > 4000:
        return
    for rx, what in SECRETS:
        if re.search(rx, line):
            problems.append(f"{where}  {what}  ->  {line.strip()[:90]}")
    for m in ASSIGN.finditer(line):
        v = m.group(2)
        faux = path.startswith("tests/") and not (len(v) >= 20 and re.search(r"\d", v) and re.search(r"[A-Za-z]", v))
        if not faux and not PLACEHOLDER.match(v):
            problems.append(f"{where}  valeur en dur pour « {m.group(1)} »  ->  {line.strip()[:90]}")
    for rx in DENY:
        if rx.search(line):
            problems.append(f"{where}  motif de .safety-deny « {rx.pattern} »  ->  {line.strip()[:90]}")
    if not any(k in path for k in IP_QUIET) and (m := PRIVATE_IP.search(IP_EXAMPLE.sub("", line))):
        ips.setdefault(where.rsplit(":", 1)[0], set()).add(m.group(0))


def scan_diff(label: str, args: list[str]) -> None:
    """Lignes ajoutées d'un diff + chemins ajoutés ou modifiés."""
    names = git("diff", *args, "--name-only", "--diff-filter=ACMR", "-z").split("\0")
    for p in filter(None, names):
        if forbidden(p):
            problems.append(f"{label}  fichier interdit : {p}")
        elif PRIVATE_IP.search(p) or any(rx.search(p) for rx in DENY):
            problems.append(f"{label}  chemin sensible : {p}")
    path, n = "", 0
    for ln in git("diff", *args, "-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR").splitlines():
        if ln.startswith("+++ "):
            path = ln[6:] if ln.startswith("+++ b/") else ""
        elif ln.startswith("@@"):
            m = re.search(r"\+(\d+)", ln)
            n = int(m.group(1)) - 1 if m else 0
        elif ln.startswith("+") and path:
            n += 1
            scan_line(f"{label} {path}:{n}", path, ln[1:])
    # images (illisibles par le scanner) et gros fichiers
    for ln in git("diff", *args, "--numstat", "--diff-filter=ACMR").splitlines():
        a, b, p = (ln.split("\t") + ["", "", ""])[:3]
        if IMAGE.search(p):
            check_image(label, args, p)
        elif a == "-" and b == "-":
            warnings.append(f"{label}  fichier binaire ajouté : {p}")


def reviewed() -> set[str]:
    if not IMAGES_OK.exists():
        return set()
    return {ln.split()[0] for ln in IMAGES_OK.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")}


def check_image(label: str, args: list[str], path: str) -> None:
    """Une image peut montrer IP, domaines, jetons : bloquée tant que son empreinte n'est pas dans images-relues.txt."""
    ref = args[-1].removesuffix("^!") if args and args[-1] != "--cached" else ""
    blob = subprocess.run(["git", "show", f":{path}" if not ref else f"{ref}:{path}"], cwd=ROOT, capture_output=True).stdout
    digest = hashlib.sha256(blob).hexdigest()[:32]
    if digest not in reviewed():
        problems.append(f"{label}  image non relue : {path}  (empreinte {digest}) : la regarder, l'anonymiser si besoin, "
                        f"puis ajouter « {digest}  {path} » à scripts/images-relues.txt")


def scan_tree(ref: str) -> None:
    for p in filter(None, git("ls-tree", "-r", "--name-only", "-z", ref).split("\0")):
        if forbidden(p):
            problems.append(f"{ref[:8]}  fichier interdit : {p}")
        if IMAGE.search(p):
            check_image(ref[:8], [ref], p)
    for ln in git("grep", "-nI", "-e", ".", ref, "--", ":!*.lock", ":!front/package-lock.json", ":!requirements.txt", check=False).splitlines():
        _, _, rest = ln.partition(":")
        p, _, rest = rest.partition(":")
        n, _, text = rest.partition(":")
        scan_line(f"{ref[:8]} {p}:{n}", p, text)


def commits(*rng: str) -> list[str]:
    return git("rev-list", "--reverse", *rng, check=False).split()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    mode = argv[0]
    if mode == "--staged":
        scan_diff("indexé", ["--cached"])
    elif mode == "--range" and len(argv) > 1:
        for c in commits(*argv[1:]):
            scan_diff(c[:8], [f"{c}^!"] if git("rev-list", "--parents", "-n1", c).count(" ") < 2 else [f"{c}^1", c])
    elif mode == "--tree":
        scan_tree(argv[1] if len(argv) > 1 else "HEAD")
    elif mode == "--history":
        for c in commits("--all"):
            scan_diff(c[:8], [f"{c}^!"])
    else:
        print(__doc__)
        return 2
    for f, found in ips.items():
        warnings.append(f"{f}  IP privée hors exemples ({', '.join(sorted(found))}) : réelle ?")
    for w in dict.fromkeys(warnings):
        print(f"  ⚠ {w}")
    if problems:
        print("\n✗ DONNÉES SENSIBLES : rien n'est parti.", file=sys.stderr)
        for p in dict.fromkeys(problems):
            print(f"  ✗ {p}", file=sys.stderr)
        print("\n  Retirer la donnée (git rm --cached, variable d'environnement, fichier *.example) ; faux positif assumé : "
              f"ajouter « {ALLOW_MARK} » sur la ligne.\n  Déjà commitée ? Ne pas pousser : la réécrire (git commit --amend / rebase) "
              "et révoquer le secret.", file=sys.stderr)
        return 1
    print("  ✓ aucune donnée sensible")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
