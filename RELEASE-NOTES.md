# Notes de version : MyServices 0.9.7

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.7** (11 octobre 2026) refait la page Réglages → Découverte, montre sur chaque connecteur ce qu'il lit vraiment, et ajoute des logos à l'accueil et à la page DNS.

## Pour tout le monde

**Quoi de neuf ?**
- **Réglages → Découverte refaite** : les « actions importantes » (ce qui reste à faire) en haut, puis les découvertes rangées par famille (Réseau et machines, Services et applis, Sauvegardes). « Jamais lancée » et « prochaine » sont des pastilles de couleur. La recherche réseau, sa fréquence et ses boutons tiennent dans une seule carte.
- **Ce que lit chaque connecteur** : les cartes de Réglages → Connecteurs affichent, après chaque collecte, des pastilles comme `entities : 4593`, preuve que la lecture fonctionne. Le bouton « Tester » reste sur la carte.
- **Lectures par SSH ou par l'agent** (AdGuard, Docker, processus) : un bloc en lecture seule les liste dans Réglages → Connecteurs, avec un lien vers la machine pour les régler. AdGuard lu par SSH n'y avait aucune carte.
- **Page DNS** : logo et titre AdGuard Home, pastille « AdGuard » sur chaque carte (l'onglet pourra accueillir d'autres sources DNS plus tard : UniFi, box de l'opérateur…).
- **Accueil** : les compteurs de droite montrent le vrai logo de l'appli (Nginx Proxy Manager, Docker, AdGuard Home) ou une icône du thème ; le cœur de Santé est vert.

**Ce qu'il faut savoir**
- Les pastilles de lecture prouvent que le connecteur lit quelque chose, pas que chaque route de l'API est juste.
- Les connecteurs de la 0.9.5 restent essayés surtout contre de faux serveurs : dites-nous ce qui ne va pas avec les vrais services.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.7` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **Connecteurs** : `Status.found` et `base.tally()` (décompte de la lecture), repris par `POST /connectors/settings/{type}/test` (champ `found`).
- **Tests** : 431 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
