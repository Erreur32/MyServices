"""Réglages → Connecteurs : lecture et écriture des instances dans config.json, essai sans enregistrer.

Seuls les connecteurs réglés par URL et compte sont modifiables ici (NPM, Beszel, Uptime Kuma, Dozzle,
Web-Check…). Ceux lus par SSH (Docker, process, AdGuard) découlent des machines (services-meta.json :
section Machines) ; les alertes ont leur propre section (alerts.py). NPM reste dans la clé « npm » de
config.json (lue aussi par npmapi.py), les autres dans « connectors ».

Secrets : jamais renvoyés à la page (« set » dit seulement s'ils sont renseignés) ; champ secret laissé vide
à l'enregistrement = valeur gardée ; écrits chiffrés (secrets_store, version Docker). Le fichier est remplacé
d'un coup (fichier temporaire puis renommage, 600). Prise en compte : au prochain passage de la collecte.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import secrets_store
from connectors import TYPES
from connectors.base import ConnectorError, Context

SSH_TYPES = {"docker", "process", "adguard"}  # découlent des machines
ALERT_TYPES = {"discord", "telegram"}  # section Alertes
TEST_TIMEOUT = 20


class SettingsError(Exception):
    """Refus lisible (type inconnu, nom pris, champ requis…)."""


def config_file() -> Path:
    return Path(os.environ.get("MYSERVICES_CONFIG") or Path(__file__).resolve().parent.parent / "config.json")


def editable() -> dict:
    return {t: c for t, c in TYPES.items() if t not in SSH_TYPES | ALERT_TYPES}


def schema() -> list[dict]:
    """Types réglables et leurs champs : la page en génère les formulaires."""
    return [{"type": t, "label": c.label, "kinds": list(c.kinds), "tested": list(c.tested), "guide": list(getattr(c, "guide", ())),
             "fields": [{"name": f.name, "label": f.label, "kind": f.kind, "required": f.required, "secret": f.secret,
                         "default": f.default, "help": f.help, "choices": list(f.choices)} for f in c.fields]}
            for t, c in editable().items()]


def _raw() -> dict:
    f = config_file()
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    except ValueError as e:
        raise SettingsError(f"{f} illisible : {e}") from None


def _key(type_: str) -> str:
    return "npm" if type_ == "npm" else "connectors"


def _entries(raw: dict) -> list[tuple[str, int, dict]]:
    """(clé de config.json, position, réglages avec « type ») de chaque instance modifiable."""
    out = [("npm", i, {**c, "type": "npm"}) for i, c in enumerate(raw.get("npm") or [])]
    out += [("connectors", i, c) for i, c in enumerate(raw.get("connectors") or []) if c.get("type") in editable()]
    return out


def _secret_names(type_: str) -> set[str]:
    return {f.name for f in TYPES[type_].fields if f.secret}


def listing(statuses: list[dict]) -> list[dict]:
    """Instances pour la page : réglages publics, secrets masqués, état au dernier passage."""
    st = {(s.get("type"), s.get("name")): s for s in statuses}
    out = []
    for _, _, c in _entries(_raw()):
        t, secret = c["type"], _secret_names(c["type"])
        out.append({"type": t, "label": TYPES[t].label, "name": c.get("name") or t,
                    "config": {k: v for k, v in c.items() if k not in secret | {"type", "name", "enabled"}},
                    "set": {k: bool(c.get(k)) for k in secret},
                    "enabled": c.get("enabled", True) is not False,
                    "status": st.get((t, c.get("name") or t))})
    return out


def _clean(type_: str, conf: dict) -> dict:
    """Champs connus seulement, convertis selon leur sorte ; vides retirés."""
    out = {}
    for f in TYPES[type_].fields:
        v = conf.get(f.name)
        if v in (None, ""):
            continue
        if f.kind == "number":
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise SettingsError(f"« {f.label} » : nombre attendu") from None
        elif f.kind == "bool":
            v = bool(v) if not isinstance(v, str) else v.lower() in ("1", "true", "oui", "on")
        else:
            v = str(v).strip()
            if f.kind == "url" and v and not v.startswith(("http://", "https://")):
                raise SettingsError(f"« {f.label} » : l'URL doit commencer par http:// ou https://")
            if f.choices and v not in f.choices:
                raise SettingsError(f"« {f.label} » : valeur hors liste")
        out[f.name] = v
    return out


def _merged(type_: str, name: str, conf: dict, old: dict | None) -> dict:
    """Réglages finaux : secrets vides repris de l'ancienne instance (encore chiffrés), puis contrôle."""
    if type_ not in editable():
        raise SettingsError("connecteur inconnu ou réglé ailleurs (Machines, Alertes)")
    name = (name or "").strip()
    if not name or len(name) > 64:
        raise SettingsError("nom requis (64 caractères au plus)")
    new = _clean(type_, conf)
    for k in _secret_names(type_):
        if k not in new and old and old.get(k):
            new[k] = old[k]
    plain = secrets_store.decrypt_all(new, config_file())
    if missing := TYPES[type_].validate(plain):
        raise SettingsError(", ".join(missing))
    return {"name": name, **new}


def _write(raw: dict) -> None:
    f = config_file()
    out, _ = secrets_store.encrypt_all(raw, f)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(f)


def _find(raw: dict, type_: str, name: str) -> tuple[str, int, dict]:
    for key, i, c in _entries(raw):
        if c["type"] == type_ and (c.get("name") or type_) == name:
            return key, i, c
    raise SettingsError(f"connecteur {type_} « {name} » introuvable")


def save(type_: str, name: str, conf: dict, original: str | None = None) -> None:
    """Ajoute (original None) ou remplace l'instance « original » de ce type (renommage possible)."""
    raw = _raw()
    old = _find(raw, type_, original)[2] if original else None
    if name != original and any(c["type"] == type_ and c.get("name") == name for _, _, c in _entries(raw)):
        raise SettingsError(f"{TYPES[type_].label} « {name} » existe déjà : choisir un autre nom")
    new = _merged(type_, name, conf, old)
    if old is not None and old.get("enabled") is False:
        new["enabled"] = False  # modifier ses réglages ne rallume pas un connecteur coupé
    key = _key(type_)
    entry = new if key == "npm" else {"type": type_, **new}
    lst = list(raw.get(key) or [])
    if old is not None:
        lst[_find(raw, type_, original)[1]] = entry
    else:
        lst.append(entry)
    raw[key] = lst
    _write(raw)


def set_enabled(type_: str, name: str, on: bool) -> None:
    """Interrupteur : coupé = réglages gardés, rien de lu (config.load l'écarte) ni d'onglet ou de compteur."""
    raw = _raw()
    key, i, _ = _find(raw, type_, name)
    entry = dict(raw[key][i])
    if on:
        entry.pop("enabled", None)
    else:
        entry["enabled"] = False
    raw[key][i] = entry
    _write(raw)


def delete(type_: str, name: str) -> None:
    raw = _raw()
    key, i, _ = _find(raw, type_, name)
    raw[key] = [c for j, c in enumerate(raw[key]) if j != i]
    _write(raw)


def get(type_: str, name: str, plain: bool = False) -> dict | None:
    """Réglages enregistrés d'une instance (secrets encore chiffrés, ou en clair avec plain=True), None si absente."""
    for _, _, c in _entries(_raw()):
        if c["type"] == type_ and (c.get("name") or type_) == name:
            return secrets_store.decrypt_all(dict(c), config_file()) if plain else dict(c)
    return None


def names(type_: str) -> list[str]:
    """Noms des instances actives (non coupées) de ce type."""
    return [c.get("name") or type_ for _, _, c in _entries(_raw()) if c["type"] == type_ and c.get("enabled", True) is not False]


def resolve(type_: str, name: str, conf: dict, original: str | None = None) -> dict:
    """Réglages du formulaire en clair, secrets vides repris de l'instance « original » : pour essayer sans enregistrer."""
    raw = _raw()
    old = _find(raw, type_, original)[2] if original else None
    return secrets_store.decrypt_all(_merged(type_, name or type_, conf, old), config_file())


def test(type_: str, name: str, conf: dict, original: str | None = None) -> dict:
    """Essai des réglages du formulaire, sans enregistrer (secrets vides = ceux déjà enregistrés)."""
    conn = TYPES[type_](resolve(type_, name, conf, original), Context(timeout=TEST_TIMEOUT))
    try:
        r = conn.test()
    except ConnectorError as e:
        return {"ok": False, "message": str(e), "version": None}
    except Exception as e:  # bug du connecteur : message lisible plutôt qu'une erreur 500
        return {"ok": False, "message": f"erreur du connecteur : {type(e).__name__}", "version": None}
    from connectors.base import version_tested
    return {"ok": r.ok, "message": r.message, "version": r.version,
            "version_tested": version_tested(r.version, TYPES[type_].tested)}
