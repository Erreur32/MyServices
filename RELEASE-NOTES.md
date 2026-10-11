# Notes de version : MyServices 0.9.9

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.


**0.9.9** (11 octobre 2026) simplifie Réglages → Connecteurs, ajoute Proxmox Backup aux sauvegardes, quatre nouveaux connecteurs et une page Aide, et allège les échanges de la page.

## Pour tout le monde

**Quoi de neuf ?**
- **Services détectés non configurés** : en haut de Réglages → Connecteurs, un tableau des applis reconnues (Home Assistant, NPM, AdGuard, Frigate…) qui n'ont pas encore d'accès réglé, en orange ; un clic ouvre une fenêtre avec le formulaire déjà rempli. Celles déjà reliées n'y figurent pas.
- **Connecteurs plus simples** : chaque carte a son interrupteur « Collecte » (à droite, sur la ligne de la version). L'onglet « Activation » et les interrupteurs « Affichage » (NPM, AdGuard, Apache) disparaissent : ce qui est détecté ou relié est toujours lu et affiché.
- **Réglages → Machines en deux sous-onglets** : « Machines » et « SSH & Agents ». Le dernier sous-onglet ouvert est retenu, et les cartes sont en deux colonnes indépendantes (ouvrir l'une ne déforme plus l'autre). Le bloc « SSH Agent Actif » est plié par défaut, en bas.
- **Proxmox Backup Server dans les sauvegardes** : les groupes de sauvegarde (une VM, un conteneur ou un hôte par magasin) se suivent comme des jobs Veeam, avec le jeton du connecteur. L'assistant Veeam reprend lui aussi le compte du connecteur sans le redemander.
- **Sauvegardes et notifications refaites** : Réglages → Sauvegardes a un tableau des sources (dossiers, Veeam, Proxmox Backup, Home Assistant) dont les champs se déplient au clic, et des sauvegardes suivies en cartes ; Notifications a des sous-onglets et des cartes alignées.
- **Quatre connecteurs en plus** : Prometheus (cibles hors ligne, alertes), Healthchecks (tâches en échec ou en retard), Netdata (alarmes) et Jellyfin (lectures en cours, mise à jour).
- **Page Aide** (Réglages, au-dessus de « À propos ») : par où commencer en six étapes, comment MyServices lit le réseau, bons réflexes, dépannage.
- **Historique** : s'ouvre sur les dernières 24 h en barres ; la période et le style choisis sont retenus.
- **Finitions** : titres de cartes plus visibles, tâches et horaires alignés en colonnes, clé SSH avec ses machines en tableau, drapeaux sur les boutons de langue, introduction des connecteurs en une phrase.
- **Moins d'appels et de données** : la liste des découvertes est lue une seule fois pour toute la page, rien n'est relu quand l'onglet est masqué, les réponses sont compressées (gzip) et un fichier inchangé n'est plus renvoyé (ETag).

**Ce qu'il faut savoir**
- Les nouveaux connecteurs (Prometheus, Healthchecks, Netdata, Jellyfin) et Proxmox Backup sont écrits d'après la documentation de chaque service et **essayés seulement contre de faux serveurs** : dites-nous ce qui ne va pas avec les vrais.
- Le réglage `sources` et ses routes `GET/PUT /sources` sont retirés ; une ancienne clé `sources` dans `config.json` est ignorée.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.9` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **API** : `data.json` gagne `detected_apps` ; `POST /backups/pbs/discover` et `PUT /backups/pbs` ; `GET/PUT /sources` supprimés.
- **Sauvegardes** : hôte `api: "pbs"`, emplacement `pbs_group` (magasin/type/id).
- **Tests** : 447 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
