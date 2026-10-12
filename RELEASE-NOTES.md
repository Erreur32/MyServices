# Notes de version : MyServices 0.10.23

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.23** (12 octobre 2026) : alertes Nextcloud, Santé sans les cartes de virtualisation.

## Pour tout le monde

**Quoi de neuf ?**
- **Alertes Nextcloud** : une alerte quand un point à regarder apparaît (mise à jour de Nextcloud ou d'une appli, liens publics sans mot de passe, moins de 10 Go libres, mode debug), une seule fois, pas à chaque changement de chiffre. Nouvelle règle d'exemple « Nextcloud (mises à jour, liens publics, espace) ».

**Changé**
- **Santé** n'affiche plus les cartes Proxmox, ESXi, vCenter et Proxmox Backup : elles étaient en double avec l'onglet Virtualisation. Santé garde Dockhand et les services lus par leur API (Home Assistant, Nextcloud…).

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Sur une installation existante, l'alerte Nextcloud n'est pas cochée toute seule : Réglages → Alertes (ou ajoutez la règle d'exemple).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.23` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `checks` [{key, text}] dans la réponse du connecteur Nextcloud ; genre d'alerte `nextcloud` (`watcher.nextcloud_snaps` / `diff_nextcloud`).
- **Front** : `InfraCards` ne prend plus les lignes de virtualisation.
- **Tests** : 526 Python, 98 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
