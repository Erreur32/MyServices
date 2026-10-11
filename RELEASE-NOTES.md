# Notes de version : MyServices 0.9.6

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.6** (11 octobre 2026) prend en compte les connecteurs d'API (Home Assistant en tête) sur la page Machines, ajoute un bouton « Tester » direct sur chaque connecteur et rend l'interface plus lisible.

## Pour tout le monde

**Quoi de neuf ?**
- **Home Assistant et les connecteurs d'API comptent enfin pour les machines** : une machine lue par l'API d'un connecteur n'est plus « en ligne sans SSH » mais « API », sa fiche indique le connecteur et sa version. Home Assistant remonte aussi les capteurs de sa machine (processeur, mémoire, disque, température) : ils alimentent l'onglet Santé comme source « Home Assistant ».
- **Bouton « Tester » sur chaque connecteur**, sans ouvrir le formulaire : cadre vert ou rouge, version, et une pastille par type d'information lue (entités, hôtes, conteneurs…), ce qui prouve que le connecteur lit vraiment quelque chose. Le bouton de la carte ne dit plus que « Modifier ».
- **Onglet Machines** : colonne « À surveiller » (icônes selon la gravité, synthèse dépliable), état « Agent actif ».
- **Agents** : la carte repliée montre la mise à jour automatique et si l'agent n'est pas à jour ; détails sur plusieurs lignes ; logo du système.
- **Boutons-icônes** à la place de plusieurs menus déroulants (type de jeton, durées, délais des alertes…).
- **Réglages → Machines** : cartes de même hauteur, les pastilles passent à la ligne.

**Ce qu'il faut savoir**
- Le décompte du bouton « Tester » prouve que la lecture fonctionne, pas que chaque route de l'API est juste.
- Les connecteurs de la 0.9.5 restent **essayés seulement contre de faux serveurs** (sauf Home Assistant et Dockhand).
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.6` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **Nouveau** : `api_link.py` (lien connecteur ↔ machine par l'adresse), source de santé `ha` (`health.py`), `connectors/settings.tally()` et champ `found` de `POST /connectors/settings/{type}/test`.
- **Tests** : 431 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
