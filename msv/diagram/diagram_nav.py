"""Schémas de l'infra (Archify) : liste, et bandeau ajouté au bas de chaque page générée.

Archify produit des pages HTML autonomes, sans lien vers l'application ni mention de leur origine. Après chaque génération, un bandeau fin est
ajouté en bas de page : retour à MyServices, liens vers les autres schémas, et « Généré avec Archify » (lien vers le projet). L'ajout est
idempotent (marqueur), n'utilise que du HTML et du style en ligne, et ne touche pas au schéma lui-même.
"""
from __future__ import annotations

import re

ARCHIFY_URL = "https://github.com/tt-a1i/archify"
MARK = "<!-- myservices-nav -->"

# (id = nom du fichier sans .html, titre, ce que le schéma montre, source nécessaire ou None)
DIAGRAMS = [
    ("carte", "Carte du réseau", "Internet, vos NPM et AdGuard, et chaque machine avec son niveau de santé : qui publie quoi, vers quelles machines.", None),
    ("acces", "Accès aux machines", "Comment chaque machine est lue : SSH (compte et port), agent, ou aucun accès. Montre d'un coup d'œil ce qui reste à relier.", None),
    ("alertes", "Chaîne d'alertes et de notifications", "De la collecte à l'historique, puis aux alertes et aux notifications, jusqu'aux canaux Discord, Telegram et webhook.", None),
    ("sauvegardes", "Carte des sauvegardes", "Qui sauvegarde sur quoi : machines d'origine, stockages, nombre de jeux et âge de la copie la plus récente.", "backups"),
]


def optional() -> list[tuple[str, str, str, str]]:
    """Schémas proposés, à créer d'un clic : (id, titre, ce qu'il montre, besoin). Voir archify_extra.py."""
    from msv.diagram.archify_extra import CATALOG
    return [(k, t, w, n) for k, (t, w, n) in CATALOG.items()]


def all_diagrams() -> list[tuple[str, str, str, str | None]]:
    return [*DIAGRAMS, *optional()]

_BAR = ("position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:7px 14px;"
        "background:rgba(15,18,28,.94);color:#cfd6e6;font:12px/1.4 system-ui,sans-serif;border-top:1px solid rgba(255,255,255,.14)")
_LINK = "color:#7cc4ff;text-decoration:none"


def nav_html(current: str, available: list[str]) -> str:
    """Le bandeau : ← MyServices, autres schémas (celui qu'on regarde est en gras, sans lien), puis l'origine du schéma."""
    titles = {k: t for k, t, _, _ in all_diagrams()}
    sib = []
    for k, t, _, _ in all_diagrams():
        if k not in available:
            continue
        sib.append(f'<b style="color:#fff">{t}</b>' if k == current else f'<a style="{_LINK}" href="{k}.html">{t}</a>')
    return (f'{MARK}<div id="ms-nav" style="{_BAR}"><a style="{_LINK};font-weight:600" href="./">← MyServices</a>'
            f'<a style="{_LINK}" href="./#diagrams">Tous les schémas</a><span style="opacity:.5">|</span>{" · ".join(sib)}'
            f'<span style="margin-left:auto;opacity:.85">Généré avec <a style="{_LINK}" href="{ARCHIFY_URL}" target="_blank" rel="noopener noreferrer">Archify</a>'
            f' · schéma « {titles.get(current, current)} » · MyServices</span></div>'
            '<style>body{padding-bottom:44px}</style>')


def inject(html: str, current: str, available: list[str]) -> str:
    """Page avec son bandeau (remplace l'ancien s'il y en a un) ; inchangée si elle n'a pas de </body>."""
    html = re.sub(re.escape(MARK) + r'.*?</style>', "", html, flags=re.S)
    i = html.rfind("</body>")
    return html if i < 0 else html[:i] + nav_html(current, available) + html[i:]
