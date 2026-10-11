#!/usr/bin/env python3
"""Numéro de version du projet : un seul endroit à lancer, tout le reste suit.

  release.py                 affiche la version et vérifie que tous les fichiers disent la même chose (code 1 sinon)
  release.py patch | minor   calcule la version suivante (0.9.3 -> 0.9.4 | 0.10.0)
  release.py 0.9.4           applique cette version
  options                    --date AAAA-MM-JJ (défaut : aujourd'hui)   --dry-run (montre sans écrire)

Ce qui est mis à jour :
  front/package.json et front/package-lock.json   « version »
  README.md, README.fr.md                          étiquette d'image figée (`:0.9.4`) et exemple « (`0.9.4`, `0.9.5`…) »
  CHANGELOG.md                                     « ## Unreleased … » devient « ## v0.9.4 (date) », une section « Unreleased » vide est rouverte
  RELEASE-NOTES.md                                 titre, ligne de version (date en français) et étiquette d'image ; le TEXTE reste à écrire
Le badge de version du README (shields.io « github/v/release ») se met à jour tout seul avec la release GitHub.
Le script ne committe, ne tague et ne pousse rien : il affiche les commandes à lancer ensuite.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


class ReleaseError(Exception):
    pass


def bump(version: str, kind: str) -> str:
    major, minor, patch = (int(x) for x in version.split("."))
    return {"patch": f"{major}.{minor}.{patch + 1}", "minor": f"{major}.{minor + 1}.0", "major": f"{major + 1}.0.0"}[kind]


def french_date(d: dt.date) -> str:
    return f"{d.day}{'er' if d.day == 1 else ''} {MONTHS[d.month - 1]} {d.year}"


def read(root: Path, rel: str) -> str:
    try:
        return (root / rel).read_text(encoding="utf-8")
    except OSError as e:
        raise ReleaseError(f"{rel} illisible : {e}") from None


def current(root: Path = ROOT) -> str:
    v = json.loads(read(root, "front/package.json")).get("version", "")
    if not SEMVER.match(v):
        raise ReleaseError(f"front/package.json : version « {v} » invalide (attendu X.Y.Z)")
    return v


# ── ce que dit chaque fichier ────────────────────────────────────────────────────────────

def seen(root: Path = ROOT) -> dict[str, str | None]:
    """Version annoncée par chaque fichier (None = introuvable)."""
    out: dict[str, str | None] = {}
    out["front/package.json"] = json.loads(read(root, "front/package.json")).get("version")
    lock = json.loads(read(root, "front/package-lock.json"))
    out["front/package-lock.json"] = lock.get("version")
    out["front/package-lock.json (packages)"] = (lock.get("packages", {}).get("") or {}).get("version")
    for rel in ("README.md", "README.fr.md"):
        m = re.search(r"`:(\d+\.\d+\.\d+)`", read(root, rel))
        out[rel] = m.group(1) if m else None
    m = re.search(r"^## v(\d+\.\d+\.\d+) \(", read(root, "CHANGELOG.md"), re.M)
    out["CHANGELOG.md (dernière version publiée)"] = m.group(1) if m else None
    m = re.search(r"^# Notes de version : MyServices (\d+\.\d+\.\d+)", read(root, "RELEASE-NOTES.md"), re.M)
    out["RELEASE-NOTES.md"] = m.group(1) if m else None
    return out


def check(root: Path = ROOT) -> list[str]:
    """Problèmes de cohérence (liste vide = tout est d'accord). « Unreleased » en attente n'est pas un problème : c'est le travail en cours."""
    want = current(root)
    return [f"{name} : {v or 'introuvable'} (attendu {want})" for name, v in seen(root).items() if v != want]


# ── application ──────────────────────────────────────────────────────────────────────────

def apply(root: Path, new: str, date: dt.date) -> dict[str, str]:
    """Contenu à écrire, par fichier ; ReleaseError si une étape ne trouve pas sa cible (rien n'est alors écrit)."""
    old = current(root)
    if not SEMVER.match(new):
        raise ReleaseError(f"version « {new} » invalide (attendu X.Y.Z)")
    if new == old:
        raise ReleaseError(f"la version est déjà {old}")
    nxt = bump(new, "patch")
    files: dict[str, str] = {}

    def sub(rel: str, text: str, pattern: str, repl, what: str, flags: int = 0, count: int = 1) -> str:
        out, n = re.subn(pattern, repl, text, count=count, flags=flags)
        if not n:
            raise ReleaseError(f"{rel} : {what} introuvable")
        return out

    pkg = read(root, "front/package.json")
    files["front/package.json"] = sub("front/package.json", pkg, r'("version"\s*:\s*")[^"]+(")', rf"\g<1>{new}\g<2>", "« version »")
    lock = read(root, "front/package-lock.json")
    lock = sub("front/package-lock.json", lock, r'("version"\s*:\s*")[^"]+(")', rf"\g<1>{new}\g<2>", "« version » racine")
    # 2e occurrence : packages[""] (le projet lui-même), juste après le premier "name"
    lock = sub("front/package-lock.json", lock, r'("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*")[^"]+(")', rf"\g<1>{new}\g<2>", "« packages » racine", re.S)
    files["front/package-lock.json"] = lock

    for rel in ("README.md", "README.fr.md"):
        t = read(root, rel)
        t = sub(rel, t, r"`:\d+\.\d+\.\d+`", f"`:{new}`", "étiquette d'image figée")
        t = sub(rel, t, r"\(`\d+\.\d+\.\d+`, `\d+\.\d+\.\d+`…\)", f"(`{new}`, `{nxt}`…)", "exemple de numéros")
        files[rel] = t

    ch = read(root, "CHANGELOG.md")
    ch = sub("CHANGELOG.md", ch, r"^## Unreleased[^\n]*\n", f"## v{new} ({date.isoformat()})\n", "section « Unreleased » à publier", re.M)
    head = "## Unreleased (next version, not tagged yet)\n\n> **Testing phase: do not use in production.**\n\n"
    files["CHANGELOG.md"] = ch.replace(f"## v{new} ({date.isoformat()})\n", head + f"## v{new} ({date.isoformat()})\n", 1)

    rn = read(root, "RELEASE-NOTES.md")
    rn = sub("RELEASE-NOTES.md", rn, r"^(# Notes de version : MyServices )\d+\.\d+\.\d+", rf"\g<1>{new}", "titre", re.M)
    rn = sub("RELEASE-NOTES.md", rn, r"\*\*\d+\.\d+\.\d+\*\* \([^)]*\)", f"**{new}** ({french_date(date)})", "ligne de version", re.M)
    rn = sub("RELEASE-NOTES.md", rn, r"(myservices:)\d+\.\d+\.\d+", rf"\g<1>{new}", "étiquette d'image", re.M)
    files["RELEASE-NOTES.md"] = rn
    return files


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="X.Y.Z, patch, minor ou major (rien : seulement vérifier)")
    ap.add_argument("--date", help="AAAA-MM-JJ (défaut : aujourd'hui)")
    ap.add_argument("--dry-run", action="store_true", help="montrer ce qui changerait sans rien écrire")
    args = ap.parse_args(argv)
    try:
        old = current()
        if not args.target:
            print(f"Version du projet : {old}")
            problems = check()
            for p in problems:
                print(f"  ✗ {p}")
            if not problems:
                print("  ✓ package.json, package-lock.json, README (EN, FR), CHANGELOG et notes de version sont d'accord")
            return 1 if problems else 0
        new = bump(old, args.target) if args.target in ("patch", "minor", "major") else args.target
        date = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
        files = apply(ROOT, new, date)
    except (ReleaseError, ValueError) as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1
    for rel, text in files.items():
        changed = text != (ROOT / rel).read_text(encoding="utf-8")
        print(f"  {'✎' if changed else '='} {rel}")
        if changed and not args.dry_run:
            tmp = (ROOT / rel).with_suffix((ROOT / rel).suffix + ".tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(ROOT / rel)
    print(f"{'(essai, rien écrit) ' if args.dry_run else ''}{old} -> {new}")
    if not args.dry_run:
        print("À faire à la main : réécrire RELEASE-NOTES.md (le texte), puis, quand vous le décidez :\n"
              f"  git add -A && git commit -m \"Version {new}\"\n  git tag v{new}\n  git push github docker --tags   (seulement sur demande)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
