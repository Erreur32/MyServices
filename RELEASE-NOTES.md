# Notes de version : MyServices 0.10.11

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.11** (12 octobre 2026) : les tâches lancées à la main gardent le bon compte, et des cartes mieux délimitées.

## Pour tout le monde

**Quoi de neuf ?**
- **Tâches lancées à la main** (`docker compose exec myservices python3 myservices.py`, `health.py`, `watcher.py`, `backups.py`) : elles passent d'elles-mêmes sur le compte de l'app, comme `setup.py` et `manage.py`. Elles lisent donc vos machines avec la bonne configuration SSH et ne laissent plus de fichier root dans `data/`.
- **Bordure grise sur les cartes sans couleur** des pages Schémas et Sauvegardes, comme dans les Réglages.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.11` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `app_user.drop_root()` à l'entrée de `myservices.py`, `health.py`, `watcher.py`, `backups.py` (sans effet hors Docker ou déjà sous 10001) ; constante `GREY_CARDS` (front) partagée par Réglages, Schémas et Sauvegardes.
- **Tests** : 485 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
