# Notes de version : MyServices 0.11.3

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.3** (13 octobre 2026) : plus besoin de F5, nouveaux services à suivre ou non, connecteurs rangés par catégorie.

## Pour tout le monde

**Quoi de neuf ?**
- **Plus besoin de F5** : après une modification, la page se met à jour tout de suite, puis suit la collecte lancée par cette modification (lecture toutes les 5 s pendant 2 min 30). La liste des connecteurs se relit aussi à la fin de chaque collecte.
- **Nouveaux services sur les machines** (accueil, administrateurs) : les conteneurs et process apparus ces 7 derniers jours sont proposés. « Suivre » ne change rien ; « Ne pas suivre » les met en pause (ni sonde ni alerte). Un service en pause le dit dans sa fiche (onglet Services), avec un bouton « Reprendre le suivi ». Sans réponse, ils sont suivis comme avant.
- **Ajouter un connecteur** : les cartes sont rangées par ordre alphabétique, avec un filtre par catégorie (Monitoring, Médias, Réseau / DNS, Sauvegardes…).
- **Corrigé** : supprimer un connecteur dont le formulaire était ouvert laissait « Ajouter un connecteur » grisé.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.3` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `new_services.py` et ses routes `GET /api/v1/services/new`, `POST /api/v1/services/new/follow` et `/ignore`, `DELETE /api/v1/services/pause/{ip:port}` (admin) ; `front/src/components/NewServices.tsx`.
- **Modifié** : `front/src/api.ts` (relecture après chaque écriture), `front/src/App.tsx` (lecture rapprochée après un changement), `connectors/settings.py` (catégorie de chaque connecteur), `front/src/tabs/Connectors.tsx`, `front/src/tabs/ServiceDetail.tsx`.
