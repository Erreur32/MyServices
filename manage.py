#!/usr/bin/env python3
"""Comptes de la page MyServices (version Docker), en ligne de commande.

  docker compose exec myservices python3 manage.py users                      liste
  docker compose exec myservices python3 manage.py add <nom> [admin|viewer]   crée (mot de passe demandé)
  docker compose exec myservices python3 manage.py password <nom>             change le mot de passe
  docker compose exec myservices python3 manage.py delete <nom>               supprime
  docker compose exec myservices python3 manage.py audit [N]                  N dernières actions
  docker compose exec myservices python3 manage.py encrypt-secrets            chiffre les secrets de config.json

Le premier compte se crée ici (jamais depuis la page : personne d'autre sur le réseau ne peut le prendre).
Mot de passe : demandé deux fois sans écho, ou lu sur l'entrée standard (--stdin), jamais en argument.
"""
from __future__ import annotations

import getpass
import sys
from datetime import datetime

import app_user

app_user.drop_root()   # docker compose exec : root -> compte 10001, sinon la base et les secrets écrits seraient à root

from auth import AuthError, Store, db_path
from config import CFG

DB = db_path(CFG)


def ask_password() -> str:
    if "--stdin" in sys.argv:
        return sys.stdin.readline().rstrip("\n")
    p1 = getpass.getpass("Mot de passe (12 caractères minimum) : ")
    if p1 != getpass.getpass("Encore une fois : "):
        sys.exit("les deux saisies diffèrent")
    return p1


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    store, cmd = Store(DB), args[0]
    try:
        if cmd == "users":
            for u in store.users():
                last = datetime.fromtimestamp(u["last_login"]).strftime("%Y-%m-%d %H:%M") if u["last_login"] else "jamais"
                print(f"{u['username']:24} {u['role']:7} dernière connexion : {last}{' (désactivé)' if u['disabled'] else ''}")
        elif cmd == "add" and len(args) >= 2:
            role = args[2] if len(args) > 2 else ("viewer" if store.has_users() else "admin")
            store.create_user(args[1], ask_password(), role)
            store.audit("compte créé", "manage.py", None, f"{args[1]} ({role})")
            print(f"compte « {args[1]} » créé ({role})")
        elif cmd == "password" and len(args) == 2:
            store.set_password(args[1], ask_password())
            store.audit("mot de passe changé", "manage.py", None, args[1])
            print(f"mot de passe de « {args[1]} » changé, ses sessions fermées")
        elif cmd == "delete" and len(args) == 2:
            store.delete_user(args[1])
            store.audit("compte supprimé", "manage.py", None, args[1])
            print(f"compte « {args[1]} » supprimé")
        elif cmd == "encrypt-secrets":
            import json
            import os
            from pathlib import Path

            import secrets_store
            f = Path(os.environ.get("MYSERVICES_CONFIG") or "config.json")
            out, n = secrets_store.encrypt_all(json.loads(f.read_text(encoding="utf-8")), f)
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            tmp.chmod(0o600)
            tmp.replace(f)
            store.audit("secrets chiffrés", "manage.py", None, f"{n} valeur(s)")
            print(f"{n} secret(s) chiffré(s) dans {f} (clé : {secrets_store.key_path(f)}, à sauvegarder avec /config)")
        elif cmd == "audit":
            for a in reversed(store.audit_log(int(args[1]) if len(args) > 1 else 50)):
                print(f"{datetime.fromtimestamp(a['ts']):%Y-%m-%d %H:%M:%S} {a['ip'] or '-':15} {a['username'] or '-':12} "
                      f"{a['action']} {a['detail'] or ''}")
        else:
            print(__doc__)
            return 1
    except AuthError as e:
        sys.exit(str(e))
    return 0


if __name__ == "__main__":
    sys.exit(main())
