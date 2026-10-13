# Notes de version : MyServices 0.11.7

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.7** (13 octobre 2026) : « Oublier » partout, conteneurs arrêtés écartés, tous les réglages des tâches au même endroit.

## Pour tout le monde

**Quoi de neuf ?**
- **Oublier / Rappeler** partout où MyServices propose quelque chose : applis à relier et suggestions de Découverte (rangées dans un cadre « Oubliés »), services détectés des Connecteurs (même choix que dans Découverte), machines trouvées sur le réseau, et accès à régler d'une machine ajoutée (« Passer » devient « Oublier », gardé sur le serveur : la carte ne revient plus, son rappel de clé SSH non plus). « Rappeler » fait tout revenir.
- **Conteneurs arrêtés** : une appli vue dans un conteneur qui ne tourne pas (`docker ps -a`) n'est plus proposée. Découverte la range à part, et les services détectés des Connecteurs ont une colonne « État » (actif / arrêté).
- **Tâches et horaires, seul endroit des réglages** : la fréquence, les réseaux à parcourir et le mode discret de la recherche réseau y sont réunis. Chaque tâche dit aussi ce qu'elle découvre ; seules les recherches sans horaire gardent leur cadre « À la main ou une seule fois ». Découverte garde un bouton « Réglages de la recherche ».
- **Découverte** : « Applis à relier » se replie, le résumé du scan tient en deux lignes, et « Oublier » s'affiche tout de suite (il fallait recharger la page).
- **Liens entre réglages** : un lien d'une section des Réglages vers une autre (Découverte vers Tâches) fonctionne maintenant.
- **Aide des horaires** : format et exemples en une ligne, valeurs en blocs de code.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.7` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `known_apps.run_state()` (état du conteneur derrière une appli), `running` et `state` dans les propositions, `front/src/components/AutoDiscoveries.tsx`, identifiants `access:<ip>` dans `discoveries_muted` (accès oublié, lié au rappel `ssh:<ip>`), `muted` dans `GET /api/v1/discoveries`.
- **Modifié** : `discoveries.py`, `system.py`, `front/src/components/NetworkStep.tsx`, `front/src/components/DiscoveryCard.tsx` (relecture demandée pendant une autre : refaite), `front/src/tabs/NetworkSettings.tsx`, `front/src/tabs/SystemSettings.tsx`, `front/src/tabs/Connectors.tsx`, `front/src/tabs/Settings.tsx`.
