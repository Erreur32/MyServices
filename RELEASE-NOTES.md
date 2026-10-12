# Notes de version : MyServices 0.10.24

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.24** (12 octobre 2026) : nouvelles icônes.

## Pour tout le monde

**Quoi de neuf ?**
- **Icônes** pour les connecteurs Healthchecks, CrowdSec, Technitium DNS et Onduleur (NUT), dans Réglages → Connecteurs et sur leurs cartes de Santé. Elles sont aussi proposées pour les machines (Réglages → Machines → icône), comme Nextcloud.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.24` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `front/public/icons/` healthchecks, crowdsec, technitium, nut ; `lib/appIcons.ts` et `lib/machineIcons.ts`.
- **Tests** : 526 Python, 98 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
