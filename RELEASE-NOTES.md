# Notes de version : MyServices 0.10.4

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.4** (12 octobre 2026) sait où vos sauvegardes sont copiées, et relie chaque machine à ce que vos autres outils en voient.

## Pour tout le monde

**Quoi de neuf ?**
- **Sauvegardes, « copié ailleurs »** : dans Réglages → Sauvegardes, chaque dossier suivi peut recevoir ses copies (« Ajouter une copie » : machine, puis dossier). MyServices compare ensuite la copie à la source à chaque relevé et signale une archive manquante ou en retard.
- **« Trouver les copies »** : un bouton cherche, sur toutes vos machines, **partages réseau (NAS) compris**, où sont copiées les dernières archives de chaque dossier suivi, et les propose. Un clic sur « Relier » suffit ; rien n'est relié tout seul. Une copie sur un NAS compte comme copie hors machine.
- **Seuil d'alerte** : en plus de 2, 8, 15 et 31 jours, « autre… » accepte n'importe quelle valeur. Si vos archives arrivent moins souvent que le seuil, un bouton propose le bon (« rythme observé ~7 j : passer à 15 j »).
- **Réglages → Sauvegardes plus lisible** : chaque jeu a un titre foncé avec l'icône du système et l'IP de la machine.
- **Onglet Machines** : un badge par outil qui voit la machine (MynetworK, UniFi, Beszel, Proxmox, Dockhand), sa MAC, ses autres noms et, pour une VM, son nœud Proxmox. Le cadre « Vus par vos outils, pas suivis ici » liste tout ce que ces outils voient sans que MyServices le suive, par outil.
- **Plus rapide après une installation** : `/home/backup` trouvé sur plusieurs machines ne lance plus qu'un seul relevé (avant : une collecte complète par machine).

**Ce qu'il faut savoir**
- Proxmox (schéma), Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup restent essayés seulement contre de faux serveurs.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.4` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `matching.py` (rapprochement IP / MAC / nom, `links` et `unlinked` dans `data.json`) ; routes `POST /backups/copies/find`, `POST` et `DELETE /backups/settings/{id}/copies` ; `scripts/dev.sh` pour le développement.
- **Tests** : 477 Python, 92 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
