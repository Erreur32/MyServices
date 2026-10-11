# Notes de version : MyServices 0.10.1

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.1** (11 octobre 2026) corrige la création d'un schéma, uniformise l'apparence des cartes dans toute l'appli et refait les pages Santé, DNS et Sauvegardes.

## Pour tout le monde

**Quoi de neuf ?**
- **Correction** : créer ou régénérer un schéma dans l'onglet Schémas donnait une erreur « HTTP 500 ». C'est réparé, et l'onglet montre maintenant l'avancement (« Création en cours · depuis N s », durée de la dernière génération).
- **Un seul style de carte partout** : chaque titre de carte devient un bandeau d'en-tête avec son icône, les cartes qui demandent une action sont teintées orange (vertes quand tout va bien), et tous les titres ont maintenant une icône.
- **Santé** : SSH, agent, Beszel et API sont dans **un seul tableau**, séparés par une ligne légère par catégorie. Virtualisation, conteneurs (Dockhand) et services lus par API sont dans **une seule grille de cartes uniformes** ; la carte Dockhand liste ses environnements dans un tableau.
- **DNS** : les cartes de synchronisation et des serveurs AdGuard ont un nouveau bandeau, et chaque liste (écarts entre instances, réécritures sans host NPM, noms invalides, réécritures directes, domaines à vérifier) est un tableau aux colonnes alignées.
- **Sauvegardes** : les tuiles de chiffres tiennent sur une seule ligne, et la carte « À regarder » est un tableau (état, jeu de sauvegarde, ce qui ne va pas).
- **README et logo** : le README (français et anglais) est refait, avec des sections pliantes pour les gros blocs et un logo bâti sur la grille 3×3 du favicon (variantes claire et sombre, en SVG et en PNG).
- **Ton du projet** : MyServices est présenté comme « en ligne, mais à un stade précoce » et non plus comme « phase de test, ne pas utiliser ».

**Ce qu'il faut savoir**
- Proxmox (schéma), Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup restent essayés seulement contre de faux serveurs : dites-nous ce qui ne va pas avec les vrais.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.1` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **API** : `GET /diagrams` renvoie aussi l'état de la génération (`build`) ; `PUT /diagrams/{id}` corrigé (import manquant).
- **Front** : composant commun `TableCard`, prop `tone` sur `Card`, titres de carte en bandeau.
- **Tests** : 456 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
