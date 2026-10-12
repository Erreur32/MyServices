# Notes de version : MyServices 0.10.10

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.10** (12 octobre 2026) : l'accès SSH s'active tout seul quand la clé marche.

## Pour tout le monde

**Quoi de neuf ?**
- **Interrupteur SSH activé tout seul** : si une machine a un accès dans la configuration SSH et que la connexion par clé réussit pendant la collecte, son interrupteur « Lecture par SSH » passe tout seul sur Actif (une ligne « SSH activé tout seul… » apparaît dans Réglages → Journaux). Une machine dont la clé est refusée n'est pas touchée.
- **Couper l'interrupteur est respecté** : la machine n'est alors plus du tout lue par SSH (avant, la collecte continuait avec l'accès trouvé), et elle n'est jamais réactivée toute seule.
- **SSH & Agents** : une machine déjà lue par SSH n'est plus rangée dans « Sans accès : à régler ».

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.10` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `machines_admin.adopt_ssh()` appelé par la collecte (`myservices.py`) ; `ssh: false` dans `services-meta.json` = SSH coupé à la main (`SSH_OFF` : ni relevé SSH ni alias affiché).
- **Tests** : 485 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
