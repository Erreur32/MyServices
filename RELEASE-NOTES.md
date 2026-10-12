# Notes de version : MyServices 0.10.9

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.9** (12 octobre 2026) : des Réglages plus lisibles.

## Pour tout le monde

**Quoi de neuf ?**
- **Cartes mieux délimitées dans tous les Réglages** : chaque carte ou cadre sans couleur propre a une bordure grise bien visible ; les cartes colorées (vert, orange, rouge) ne changent pas.
- **Ce que vous modifiez est encadré en bleu** : le formulaire d'un connecteur (ajout ou modification), la carte du connecteur ou de la machine ouverte, les formulaires d'ajout de machines.
- **Liste « Ajouter un connecteur » plus contrastée** : bordure grise et fond plus foncé sur chaque carte.
- **SSH & Agents** : les catégories vides ne s'affichent plus.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.9` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : seulement le front. Une règle sur la zone des Réglages donne la bordure `dim/50` à toute carte arrondie à bordure neutre (`line`), hors survol.
- **Tests** : 483 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
