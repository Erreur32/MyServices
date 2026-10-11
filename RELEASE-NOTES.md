# Notes de version : MyServices 0.9.8

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.8** (11 octobre 2026) rend la page Réglages → Découverte utilisable : sous-onglets, cartes colorées quand il y a une action à faire, liste des machines trouvées claire, et des boutons plus lisibles partout.

## Pour tout le monde

**Quoi de neuf ?**
- **Découverte en trois sous-onglets** : Réseau et machines, Services et applis, Sauvegardes. Chaque découverte est une carte (ce qu'elle fait, dernière et prochaine fois, boutons). Ce qui reste à faire a un cadre orange, un compteur sur l'onglet et sur l'entrée « Découverte » du menu.
- **Les boutons « Choisir » et « Chercher » marchent** : ils ne renvoyaient qu'à la page déjà ouverte. La liste des machines trouvées est maintenant dans sa carte, dans un cadre plié.
- **Liste des machines trouvées** : la case cochée ne déforme plus la ligne ; les boutons « Ajouter la sélection » et « Tout désélectionner » n'apparaissent que s'il y a une sélection visible ; les appareils ignorés sont rangés dans « autres appareils » avec « Reprendre » ; le rappel « accès passés » est en haut.
- **Ne plus me le rappeler** : on peut couper le rappel d'une découverte (machines trouvées, recherche jamais lancée…) et le réafficher. Une clé SSH refusée ou un agent absent ne se coupe pas.
- **Titres des découvertes** : logo du système, puis **Appli** trouvé sur **Machine** (ip).
- **Connecteurs** : un bouton « Tester » sur chaque carte, et des pastilles de ce que la dernière collecte a lu (par exemple `entities : 4593`). Un bloc « Lus par SSH ou par l'agent » liste AdGuard, Docker et les processus.
- **Home Assistant et les API** comptent pour les machines : état « API », capteurs de l'hôte comme source de santé.
- **Boutons** : les boutons principaux sont pleins, les secondaires lisibles en thème sombre et clair, et on ne les confond plus avec les cadres dépliables.
- **Page DNS** : logo et titre AdGuard Home, pastille « AdGuard » sur chaque carte. **Accueil** : vrais logos dans les compteurs, cœur de Santé en vert.
- **Favicon et logo** : la grille 3x3 est gardée (l'essai 4x4 est retiré).

**Ce qu'il faut savoir**
- Les pastilles de lecture prouvent que le connecteur lit quelque chose, pas que chaque route de l'API est juste.
- Les connecteurs de la 0.9.5 restent essayés surtout contre de faux serveurs : dites-nous ce qui ne va pas avec les vrais services.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.8` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **API** : `PUT /discoveries/muted` ; `GET /discoveries` renvoie `app`, `machine`, `mutable`, `muted` ; réglage `discoveries_muted`.
- **Connecteurs** : `Status.found` et `base.tally()`.
- **Tests** : 432 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
