# Notes de version : MyServices 0.9.4

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.4** (11 octobre 2026) est une grosse mise à jour : l'historique est refait, de nouveaux écrans (schémas, notifications, À propos) apparaissent, et les pages Machines et Santé deviennent bien plus lisibles. Elle reprend aussi la version 0.9.3, qui n'avait pas été publiée à part (cinq nouveaux connecteurs : Proxmox, Proxmox Backup Server, MynetworK, LogviewR, Dockhand).

## Pour tout le monde

**Quoi de neuf ?**
- **Historique refait** : choisissez votre graphique, en **points** (un point par événement, à son heure exacte), en **barres**, en **courbe** ou en **carte de chaleur**. Il y a un axe du nombre d'événements avec des repères en pointillés, et chaque ligne dit ce qui l'a détectée (ping, SSH, santé…) et ce qui l'a lue.
- **Machines et Santé plus lisibles** : une seule ligne par machine (plus de défilement horizontal), un détail qui se déplie, l'icône du système (Debian, Ubuntu, Windows…), un affichage **Cartes ou Tableau** que l'application retient. Chaque information dit d'où elle vient, avec un lien vers le réglage concerné.
- **Un PC souvent éteint ne disparaît plus** de la Santé : sa fiche reste en grisé (« éteinte (voulu) »), et revient en couleurs dès qu'il se rallume.
- **Schémas** : un onglet réunit la carte du réseau, « qui lit quoi », l'accès aux machines, la chaîne d'alertes et les sauvegardes. Ils sont générés avec Archify.
- **Notifications** : en plus des alertes, vous composez vos messages : un **rapport de vos machines** à heure fixe (les capteurs de votre choix) ou les **événements en direct** d'un service ou d'une machine, sur Discord, Telegram ou un webhook. Six exemples prêts à essayer.
- **À propos** : version installée, dernière version publiée sur GitHub, journal des changements.
- **Découvertes** : l'application dit enfin ce qui se fait tout seul et ce qui demande un clic. Le dossier `/home/backup` est suivi automatiquement.
- **Services mieux reconnus** : 34 applications de plus (Pi-hole, Nextcloud, Gitea…), reconnues sans SSH.
- **Réglages plus clairs** : clé SSH masquée avec un œil pour l'afficher, comptes et journal d'audit en boutons, choix d'icône de machine avec 118 icônes de plus, nouveau logo en grille.

**Ce qu'il faut savoir**
- Une grande partie de ces écrans a été vérifiée par les tests, **pas encore à l'œil** : dites-nous ce qui ne va pas.
- **L'agent Windows doit être réinstallé** pour profiter de la version 5 (il réessaie après un démarrage, quand le réseau n'est pas prêt).
- Les connecteurs de la 0.9.3 n'ont été essayés que contre de faux serveurs ; il faut créer un jeton de lecture dans chaque outil.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.4` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **Nouveaux modules** : `notifications.py` (rapports et événements filtrés, sur les canaux des alertes), `discoveries.py`, `about.py` (version GitHub lue côté serveur, gardée 6 h, `update_check: false` pour couper), `diagram_nav.py`, `last_known.py`, `scripts/release.py` (une version, partout).
- **API** : `/notifications`, `/discoveries`, `/diagrams`, `/about`, `/backups/patterns` ; `GET /tasks` renvoie `label`, `at`, `next`.
- **Santé** : `stats.json` porte une liste `asleep` (postes souvent éteints) ; un ping ciblé chaque minute et chaque relevé d'agent relisent la machine concernée.
- **Collecte** : empreinte HTTP (en-têtes, noms de cookies, jamais leurs valeurs) pour reconnaître les applis ; dernière identification connue gardée quand un backend tombe.
- **Agent Windows v5** : réessais pendant environ 6 minutes après un démarrage, délai de 30 s, déclencheur à l'ouverture de session.
- **Tests** : 385 Python, 82 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
