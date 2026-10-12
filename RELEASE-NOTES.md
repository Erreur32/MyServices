# Notes de version : MyServices 0.10.12

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.12** (12 octobre 2026) : bordure grise sur les cartes de toutes les pages.

## Pour tout le monde

**Quoi de neuf ?**
- **Bordure grise sur les cartes sans couleur, partout** : Accueil, Machines, Services, Santé, DNS, Historique, Fail2ban et Profil, comme déjà dans les Réglages, Schémas et Sauvegardes. Les cartes de statut colorées (compteurs de l'accueil) gardent leur couleur.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.12` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `GREY_CARDS` posé une seule fois sur le conteneur de l'app (`App.tsx`) au lieu de chaque page ; les cartes à liseré `border-l-4` sont exclues.
- **Tests** : 485 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
