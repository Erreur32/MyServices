"""Schémas de l'infra (Archify) : liste, et bandeau ajouté au bas de chaque page générée.

Archify produit des pages HTML autonomes, sans lien vers l'application ni mention de leur origine. Après chaque génération, un bandeau fin est
ajouté en bas de page : retour à MyServices, liens vers les autres schémas déjà construits, et « Généré avec Archify » (texte). L'ajout est
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
    ("sauvegardes", "Carte des sauvegardes", "Qui sauvegarde sur quoi : machines d'origine, stockages, nombre de jeux et âge de la copie la plus récente.", "backups"),
]


def optional() -> list[tuple[str, str, str, str]]:
    """Schémas proposés, à créer d'un clic : (id, titre, ce qu'il montre, besoin). Voir archify_extra.py."""
    from msv.diagram.archify_extra import CATALOG
    return [(k, t, w, n) for k, (t, w, n) in CATALOG.items()]


def all_diagrams() -> list[tuple[str, str, str, str | None]]:
    return [*DIAGRAMS, *optional()]

_LINK = "color:#7cc4ff;text-decoration:none"
_PILL = "padding:2px 9px;border-radius:999px"
_BAR = ("position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:7px 14px;"
        "background:rgba(15,18,28,.94);color:#cfd6e6;font:12px/1.4 system-ui,sans-serif;border-top:1px solid rgba(255,255,255,.14)")


def nav_html(current: str, available: list[str]) -> str:
    """Le bandeau : ← MyServices, puis un lien par autre schéma déjà construit (celui qu'on regarde est en gras, sans lien ; un schéma absent n'a
    pas de lien), puis l'origine du schéma en simple texte."""
    sib = [f'<b style="{_PILL};background:rgba(124,196,255,.22);color:#fff">{t}</b>' if k == current
           else f'<a style="{_LINK};{_PILL}" href="{k}.html">{t}</a>'
           for k, t, _, _ in all_diagrams() if k in available]
    return (f'{MARK}<div id="ms-nav" style="{_BAR}"><a style="{_LINK};font-weight:600" href="./">← MyServices</a>'
            f'<a style="{_LINK}" href="./#diagrams">Tous les schémas</a><span style="opacity:.5">|</span>{"".join(sib)}'
            f'<span style="margin-left:auto;opacity:.85">Généré avec Archify · MyServices</span></div>'
            '<style>body{padding-bottom:44px}#ms-nav a:hover{text-decoration:underline!important}</style>')


def inject(html: str, current: str, available: list[str]) -> str:
    """Page avec son bandeau (remplace l'ancien s'il y en a un) ; inchangée si elle n'a pas de </body>."""
    html = re.sub(re.escape(MARK) + r'.*?</style>', "", html, flags=re.S)
    i = html.rfind("</body>")
    return html if i < 0 else html[:i] + nav_html(current, available) + html[i:]
