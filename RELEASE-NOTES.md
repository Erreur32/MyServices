# Notes de version : MyServices 0.10.2

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.2** (11 octobre 2026) met l'application à la racine du site (`http://<IP>:8090/`), refait les Premiers pas et la page de création du compte, et corrige la version affichée.

## Pour tout le monde

**Quoi de neuf ?**
- **Adresse à la racine** : l'appli s'ouvre sur `http://<IP>:8090/`, sans `/myservices/v2/`. **Les anciennes adresses marchent toujours** : les pages `/myservices/…` redirigent vers la racine, et l'API, le MCP et les scripts d'agent restent servis à l'ancienne adresse. Vos agents Windows déjà installés, vos jetons et votre configuration MCP ne bougent pas. Reconnectez-vous une fois après la mise à jour.
- **Version affichée** : une image construite depuis une branche affiche `v0.10.2+ · main · abc1234` au lieu de « docker · abc1234 » ; une image de release affiche `v0.10.2`. Le compose d'exemple tire maintenant `:latest`.
- **Premiers pas refaits** : frise avec progression, texte à jour, la machine hôte sur une seule ligne, un cadre replié « Tous les connecteurs disponibles » (un outil peut tourner sur une autre machine), un bloc « Et ensuite ? » de quatre cartes, et un bouton « Passer » unique et lisible partout. Rien n'y est obligatoire : tout se fait plus tard dans les Réglages.
- **Création du compte admin** : un œil pour voir le mot de passe, un cadre rouge sur le second champ quand les deux ne sont pas identiques, et un bouton grisé bien visible.
- **Port** : le compose d'exemple se règle avec un fichier `.env` (`MYSERVICES_PORT`), le port 8090 est en gras dans le README, et le démarrage rapide enregistre `docker-compose.yaml` et un `.env` d'exemple.
- **README** : refait avec des sections pliantes, section sur les trois façons de suivre une machine et tableau agent contre outils externes.
- **Collecte** : le texte « 2e essai des sondes en échec » devient « confirmation des sondes lentes » : c'est un passage normal, pas une panne.

**Ce qu'il faut savoir**
- Proxmox (schéma), Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup restent essayés seulement contre de faux serveurs.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.2` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Adresses** : front, API, MCP, agent et fichiers à la racine ; `/myservices/…` gardé (alias pour l'API, le MCP, l'agent et les écritures ; redirection pour les pages).
- **API** : `GET /me` renvoie aussi `released`.
- **Tests** : 459 Python, 92 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
