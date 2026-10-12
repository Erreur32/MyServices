# Notes de version : MyServices 0.10.8

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.8** (12 octobre 2026) : une commande SSH correcte même tapée en root, et des réglages plus clairs.

## Pour tout le monde

**Quoi de neuf ?**
- **Commande « autoriser la clé » corrigée** (Premiers pas, Découverte, Réglages → Machines) : elle vise le vrai dossier du compte (`/root/.ssh` ou `/home/<compte>/.ssh`), crée `.ssh` s'il manque, n'ajoute pas la clé deux fois et rend le dossier au compte (droits 700 / 600). Tapée en root pour un autre compte, elle marche maintenant : avant, la clé restait à root et la connexion était refusée.
- **Réglages → Machines → SSH & Agents** : une machine déjà lue par l'API d'un connecteur (Home Assistant…) n'est plus signalée « sans SSH, à régler » ; elle a son groupe « Lues par leur API, sans SSH ». Chaque carte montre le même badge d'accès que l'onglet Machines.
- **Réglages → Connecteurs** : « Services détectés non configurés » devient un cadre replié, facultatif, à ouvrir quand vous voulez.
- **Réglages → Journaux** rangé dans le groupe Application, avant Aide.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose depuis la 0.10.7 (`NET_RAW` dans `cap_add`).

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.8` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `authorizeFor()` (front) construit toute la commande depuis la clé de l'app ; « SSH & Agents » s'appuie sur `mState()` comme l'onglet Machines.
- **Tests** : 483 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
