# Notes de version : MyServices 0.10.0

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.


**0.10.0** (11 octobre 2026) refait l'accueil et les filtres, ajoute des schémas à créer d'un clic (réseau, services par machine, domaines, machines virtuelles) et enrichit le schéma « Accès aux machines ».

## Pour tout le monde

**Quoi de neuf ?**
- **Accueil refait** : chaque section est une carte avec un en-tête et un lien « Ouvrir → ». Les compteurs ne sont plus répétés dans le corps : ils sont à droite, et **un clic sur un compteur ouvre l'onglet déjà filtré** (par exemple NPM « à corriger », Santé « critiques », Machines « à régler »). AdGuard défile jusqu'au bon bloc.
- **Cartes repliables** : « N points demandent ton attention » (12 lignes par défaut, au choix 25, 50 ou toutes) et « À faire pour compléter la découverte » (avec un badge du nombre) se replient, et le choix est retenu.
- **Filtres sur toutes les pages** : un filtre se désactive d'un clic et se réactive d'un autre, plusieurs peuvent être actifs ensemble, toutes les pastilles sont visibles (plus de « +2 autres »), rangées en colonnes par catégorie. Le bouton « Filtres » est toujours le plus à droite, « Désactivées » de Machines est rangé dedans, et **Services s'ouvre sur « OK »**.
- **Schémas à créer d'un clic** (onglet Schémas) : équipements et appareils du réseau (passerelle, switchs, bornes Wi-Fi et ce qui est branché dessus, lu par MynetworK et UniFi), services par machine, domaines et leur chemin (NPM et Apache), machines virtuelles et conteneurs (Proxmox). Un schéma sans données est grisé.
- **« Accès aux machines » enrichi** : chaque machine est dessinée sous sa façon d'être lue (SSH, agent, connecteur, aucun accès), avec son état de santé, son compte et son port. **« Qui lit quoi (connecteurs) » est retiré** : trop léger pour servir.
- **Finitions des réglages** : les nombres des titres sont dans des bulles rondes, les cartes de Réglages → Machines ont la même taille et sont alignées, les titres de cartes sont plus visibles, les repères bleus des onglets actifs sont plus fins.

**Ce qu'il faut savoir**
- Le schéma « Machines virtuelles et conteneurs » (Proxmox) et les connecteurs Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup sont écrits d'après la documentation de chaque service et **essayés seulement contre de faux serveurs** : dites-nous ce qui ne va pas avec les vrais.
- Les schémas se créent depuis ce que MyServices a déjà lu : si une donnée manque (pas de MynetworK, pas de Proxmox), le schéma correspondant reste grisé.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.0` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **API** : `PUT /diagrams/{id}` (créer ou retirer un schéma proposé) ; `GET /diagrams` ajoute `optional` et `enabled` ; réglage `diagrams_extra`.
- **Schémas** : assemblage commun (`archify_map.grouped`), nouveaux schémas dans `archify_extra.py`, `connecteurs.html` supprimé.
- **Tests** : 455 Python, 91 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
