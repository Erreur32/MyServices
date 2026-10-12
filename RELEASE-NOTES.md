# Notes de version : MyServices 0.10.13

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.13** (12 octobre 2026) : mode automatique, accès SSH plus lisible et détails dépliés en couleur.

## Pour tout le monde

**Quoi de neuf ?**
- **Mode automatique** (activé par défaut), un seul interrupteur dans Réglages → Découverte et à la fin des Premiers pas. Après chaque recherche réseau, les machines utiles (SSH, appli reconnue ou service) sont ajoutées toutes seules puis lues ; le SSH s'active dès que la clé marche. Une machine retirée à la main ne revient pas. En mode manuel, rien n'est ajouté tout seul. Restent à faire vous-même : autoriser la clé SSH sur chaque machine, donner un jeton aux connecteurs, installer l'agent Windows.
- **Accès SSH comme dans la première version**, sur une ligne : logo SSH, compte, IP et port (en plein s'il n'est pas 22). Dans l'onglet Machines, et dans Réglages → Machines (carte et cadre « Accès SSH »).
- **Détails dépliés en couleur** sur Machines, Services et Santé : une couleur par rubrique, la colonne des libellés sur fond teinté, la source dans la bande de titre.
- **Cadre bleu** autour de la ligne ou de la carte ouverte.
- **Menu des Réglages** : au survol, le cadre de la catégorie s'illumine en bleu au lieu de perdre sa bordure.
- **Colonne Serveurs** (Machines) : deux icônes au plus, puis « +N » ; toutes dans le détail.
- Réglages → Machines : si un enregistrement est refusé, la raison s'affiche à côté du champ.

**Corrigé**
- Une machine sans aucune étiquette de rôle faisait échouer la collecte.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Le mode automatique ajoute des machines tout seul : si vous préférez choisir, coupez-le dans Réglages → Découverte.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.13` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : réglage `auto_mode` (config.json, défaut vrai), `server.auto_adopt()` (une fois par recherche terminée, mémoire dans `state/auto-mode.json`), `machines_admin.adopt_found()` / `interesting()` (même règle que la page) ; `PUT /network/settings` accepte `auto`.
- **Front** : composants partagés `DetailSection` / `DetailRow`, `SshAccess` ; constantes `OPEN_ROW`, `OPEN_DETAIL`, `OPEN_CARD`.
- **Tests** : 490 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
