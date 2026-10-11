# Notes de version : MyServices 0.10.3

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.3** (11 octobre 2026) sort les Premiers pas de l'accueil : ils ont maintenant leur propre page, en grand.

## Pour tout le monde

**Quoi de neuf ?**
- **Page d'installation à part** (`http://<IP>:8090/#setup`) : sans onglets ni en-tête, seulement les étapes, en plus gros. Une installation neuve y arrive toute seule, une fois par session ; « Terminer les premiers pas » ramène au tableau de bord.
- **Accueil plus calme** : la grosse carte est remplacée par une bannière « Premiers pas, n/6 » avec un bouton « Continuer ».
- **Revoir les premiers pas** (menu du compte) ouvre cette page ; si tout est fini, elle propose de les rouvrir.
- **Résumé de la recherche réseau** : tous les badges ont le même fond sombre.
- **Texte plus court** quand tout est lu : « Vos machines et vos conteneurs sont lus. Reste à relier vos outils. »

**Ce qu'il faut savoir**
- Proxmox (schéma), Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup restent essayés seulement contre de faux serveurs.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.3` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Front** : page `#setup` (composant `FirstSteps` en mode page), bannière sur l'accueil.
- **Tests** : 459 Python, 92 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
