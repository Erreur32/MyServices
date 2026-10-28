"""API et page de MyServices (version Docker), avec FastAPI. Lancé par server.py (uvicorn).

Sous /myservices/ :
  /                       page (web/ de l'image), fichiers produits pris d'abord dans le volume (data.json…)
  api/v1/…                API versionnée : état, connecteurs, passages ; doc OpenAPI : api/v1/docs
/healthz                  santé du conteneur (sans données)

Garde-fous : réseaux autorisés (MYSERVICES_ALLOW), puis session obligatoire (auth.py : comptes admin /
viewer, cookie HttpOnly + SameSite=Strict, en-tête X-CSRF-Token sur toute écriture), contrôle d'origine,
aucun fichier servi hors de web/ ni du volume, en-têtes de sécurité, pas de bannière de version.
MYSERVICES_AUTH=0 coupe les comptes (déconseillé : page alors ouverte à tout le réseau autorisé).
Cookies Secure : automatiques en HTTPS direct ; derrière un proxy HTTPS (NPM), MYSERVICES_COOKIE_SECURE=1.

The app, its guards and the shared helpers are in common.py; the routes are in routes/ (one module per area), included here in
the order they were declared in (the page catch-all comes last).
"""
from __future__ import annotations

from msv.api.common import app
from msv.api.routes import accounts, access, alerts, backups, history, machines, notifications, page, services, system, v1

for _module in (v1, services, machines, access, system, backups, history, accounts, alerts, notifications, page):
    app.include_router(_module.router)
