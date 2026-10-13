# Notes de version : MyServices 0.11.13

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.13** (13 octobre 2026) : une page Découverte plus claire, et des services détectés qui disent ce qu'ils apportent.

## Pour tout le monde

**Quoi de neuf ?**
- **Services détectés : ce qu'ils apportent.** Au lieu de « facultatif », chaque service détecté dit ce qu'il ajouterait (Conteneurs, Santé de la machine, Virtualisation, État du service…) et s'il est **nouveau** ou **déjà lu par** SSH, Dockhand, Beszel… Les nouveaux passent en premier.
- **Page Découverte réorganisée** :
  - « Applis à relier » devient **« Applis à activer »** (bouton « Activer » sur chaque tuile) et ne garde que les applis qui tournent ;
  - « Machines trouvées sur le réseau » devient **« Machines sur le réseau »**, avec en tête la recherche réseau (fréquence, dernière et prochaine, « Relancer la recherche » à côté de « Réglages de la recherche ») ;
  - nouveau cadre **« Arrêtés et oubliés »**, rangé par catégorie (conteneurs arrêtés, applis oubliées, autres suggestions oubliées) ;
  - en haut, le mode automatique et ce qui reste à faire vous-même, en deux petites listes.
- **Un seul nom pour la recherche réseau** : « Chercher maintenant », puis « Relancer la recherche » ; le mot « scan » disparaît des textes.
- **Boutons en icônes** avec une bulle d'aide qui explique : Tester, Modifier et Supprimer sur les cartes de connecteurs, Retirer sur les cartes de machines.
- **Badges « actif » et « arrêté »** des applis détectées : une bulle d'aide dit ce qu'ils veulent dire, avec l'état donné par Docker.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.13` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `front/src/lib/detectedValue.ts` (ce qu'apporte un service détecté, et les sources qui le lisent déjà), `front/src/lib/runState.ts` (bulles d'aide actif / arrêté).
- **Modifié** : `front/src/tabs/NetworkSettings.tsx` (Découverte), `front/src/components/NetworkStep.tsx`, `front/src/tabs/Connectors.tsx`, `front/src/tabs/MachinesSettings.tsx`, `discoveries.py` (libellés « Applis à activer », « Activer », « Chercher maintenant ») ; tests ajoutés.
