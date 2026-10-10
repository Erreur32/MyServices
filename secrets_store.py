"""Secrets de config.json chiffrés au repos (version Docker) : mots de passe NPM, jetons, webhooks.

Une valeur chiffrée s'écrit « enc:v1:<jeton Fernet> » (AES-128-CBC + HMAC-SHA256, bibliothèque
cryptography). La clé est dans un fichier à part (/config/secret.key, 600, créée une fois) : un
config.json copié, partagé ou sauvegardé seul ne révèle aucun secret. config.load() déchiffre au vol ;
sans valeur chiffrée, rien ne change (et cryptography n'est même pas chargée).
  docker compose exec myservices python3 manage.py encrypt-secrets
"""
from __future__ import annotations

import os
from pathlib import Path

PREFIX = "enc:v1:"
# Clés secrètes de config.json, et champs secrets des connecteurs (Field.secret) dans « npm » / « connectors »
TOP = ("discord_webhook", "health_webhook", "telegram_token")
NESTED = ("password", "token", "api_key", "webhook")


class SecretError(Exception):
    pass


def key_path(config_file: Path) -> Path:
    return Path(os.environ.get("MYSERVICES_SECRET_KEY") or config_file.parent / "secret.key")


def _fernet(config_file: Path, create: bool = False):
    from cryptography.fernet import Fernet
    kp = key_path(config_file)
    if not kp.exists():
        if not create:
            raise SecretError(f"{kp} absent : impossible de déchiffrer les secrets de config.json")
        kp.write_bytes(Fernet.generate_key())
        kp.chmod(0o600)
    return Fernet(kp.read_bytes().strip())


def is_encrypted(v) -> bool:
    return isinstance(v, str) and v.startswith(PREFIX)


def decrypt_all(cfg: dict, config_file: Path) -> dict:
    """Valeurs « enc:v1:… » de cfg (y compris dans les listes npm / connectors) remplacées par le clair."""
    if not _any(cfg, is_encrypted):
        return cfg
    from cryptography.fernet import InvalidToken
    f = _fernet(config_file)

    def dec(v):
        if is_encrypted(v):
            try:
                return f.decrypt(v[len(PREFIX):].encode()).decode()
            except InvalidToken:
                raise SecretError("secret illisible : clé /config/secret.key changée ou valeur abîmée") from None
        if isinstance(v, dict):
            return {k: dec(x) for k, x in v.items()}
        if isinstance(v, list):
            return [dec(x) for x in v]
        return v
    return dec(cfg)


def encrypt_all(cfg: dict, config_file: Path) -> tuple[dict, int]:
    """(config avec les secrets en clair chiffrés, nombre chiffré). Clé créée au besoin."""
    f, n = _fernet(config_file, create=True), 0

    def enc(v):
        nonlocal n
        if isinstance(v, str) and v and not is_encrypted(v):
            n += 1
            return PREFIX + f.encrypt(v.encode()).decode()
        return v
    out = dict(cfg)
    for k in TOP:
        if k in out:
            out[k] = enc(out[k])
    for k in ("npm", "connectors"):
        out[k] = [{f_: (enc(v) if f_ in NESTED else v) for f_, v in item.items()} for item in out.get(k) or []]
        if not out[k]:
            out.pop(k)
    return out, n


def _any(v, pred) -> bool:
    if isinstance(v, dict):
        return any(_any(x, pred) for x in v.values())
    if isinstance(v, list):
        return any(_any(x, pred) for x in v)
    return pred(v)
