# Notes de version : MyServices 0.11.4

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.4** (13 octobre 2026) : versions de MynetworK et LogviewR sur leur carte.

## Pour tout le monde

**Quoi de neuf ?**
- **MynetworK** : sa carte affiche la version de l'application (avec MynetworK 0.10.67 ou plus récent).
- **Corrigé** : la version de LogviewR s'affichait toujours en orange (« non testée ») à cause d'une erreur dans MyServices. Elle s'affiche maintenant normalement.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.4` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Modifié** : `connectors/mynetwork.py` (version lue dans `/api/health`, sans jeton), `connectors/logviewr.py` et `connectors/base.py` (préfixe de version testée terminé par un point).
