# Notes de version : MyServices 0.11.9

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.9** (13 octobre 2026) : cartes Machines dépliables, mises à jour des machines, Home Assistant et UniFi plus complets, annonce des nouvelles versions.

## Pour tout le monde

**Quoi de neuf ?**
- **Annonce des nouvelles versions** : Réglages → Mises à jour (groupe Application) montre la version installée et la dernière publiée, avec « Vérifier maintenant », une vérification automatique (au plus toutes les 6 h) et le choix d'afficher une pastille « vX.Y.Z disponible » dans l'en-tête ; sa croix la masque pour cette version.
- **Machines en cartes** : cartes compactes (chiffres CPU, mémoire, disque alignés), dépliables sur le même détail complet que le tableau, une seule ouverte à la fois, avec « Voir ses services ».
- **Mises à jour des machines** : leur propre partie dans le détail, liste repliée (paquets apt sous Linux, Windows Update avec l'agent) ; une flèche orange et leur nombre sur la carte repliée.
- **Tableaux Machines et Santé** : CPU, mémoire et disque en jauges alignées ; les services en panne en compteur rouge, le problème au survol ; la colonne Santé dit pourquoi elle est vide (éteinte, hors ligne, non suivie, en attente du relevé).
- **Home Assistant** : ses modules installés avec leurs icônes, son système (Home Assistant OS, Core, Supervisor, versions) sur sa carte et dans son détail.
- **UniFi par MynetworK** : la passerelle et les appareils UniFi donnent leur état, CPU, mémoire, modèle et firmware ; une machine vue par un de vos outils l'indique (« via MynetworK ») au lieu de « sans SSH ».
- **Virtualisation** : un cadre par nœud avec ses VM, jauges alignées.
- **Accueil** : l'encadré des tâches est aligné en colonnes, la plus proche en haut.
- **Corrigé** : Santé n'affichait rien quand toutes les machines allaient bien et étaient masquées ; les machines éteintes disparaissaient dès qu'un filtre était actif.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.9` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `PUT /api/v1/about/settings` (`update_check`, `update_header`), `update` dans `GET /api/v1/me` (dernière vérification gardée, sans requête), `GET /api/v1/ha/<instance>/addon-icon/<slug>` (icône en cache), `front/src/tabs/UpdatesSettings.tsx`, `front/src/lib/unifi.ts`, `front/src/lib/updateNotice.ts`.
- **Modifié** : `about.py` (`cached`), `server.py` (vérification planifiée), `connectors/home_assistant.py` (modules, système), `connectors/mynetwork.py` (CPU, mémoire, mise à jour des appareils UniFi), `health.py` (jusqu'à 30 mises à jour nommées), `front/src/tabs/Machines.tsx`, `front/src/tabs/Health.tsx`, `front/src/tabs/Virtualization.tsx`, `front/src/components/ScheduleCard.tsx`.
