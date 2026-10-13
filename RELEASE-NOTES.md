# Notes de version : MyServices 0.11.6

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.6** (13 octobre 2026) : page Découverte refaite, Tâches et horaires plus claires, planificateur réparé, sauvegardes repliées.

## Pour tout le monde

**Quoi de neuf ?**
- **Planificateur réparé** : la page des tâches lisait une autre copie du serveur que celle qui lance les tâches à l'heure. Elle ne voyait donc ni les passages ni le planificateur (« pas encore passé depuis le démarrage » à tort). C'est corrigé, et un badge dit maintenant si le planificateur tourne, avec la marche à suivre s'il s'arrête.
- **Tâches et horaires refaits** : une ligne par tâche avec son icône et ce qu'elle fait, l'horaire vérifié pendant la frappe et écrit en clair, une colonne « Prochain passage » (heure et compte à rebours) et un bouton « Exécuter maintenant ». La recherche réseau y figure aussi : sa fréquence se règle ici comme dans Découverte (même réglage).
- **Dernier passage gardé** : un redémarrage du conteneur n'efface plus le résultat du dernier passage de chaque tâche.
- **Découverte en une seule page** : l'état et le mode automatique en haut, puis ce qu'il y a à faire, les machines trouvées (repliées), les applis à relier en tuiles, les autres suggestions, ce qui tourne tout seul et les réglages de la recherche. Plus de cadres colorés imbriqués.
- **Réglages → Sauvegardes** : chaque sauvegarde suivie est repliée, son titre garde le seuil, l'interrupteur « copie hors machine exigée » et « Retirer ». Après « Chercher sur mes machines », chaque machine trouvée est repliée avec ses compteurs.
- **Connecteurs** : « Déjà lus par SSH » se place juste sous les services détectés, replié.
- **SSH & Agents** : les icônes de machine suivent le rôle et l'icône choisie (la passerelle UniFi avait perdu son logo).

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.6` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Corrigé** : `server.py` s'enregistre aussi sous le nom `server` quand il est lancé comme script, pour que `api.py` n'en charge pas une seconde copie.
- **Nouveau** : `tasks-last.json` dans le dossier d'état (dernier passage de chaque tâche) ; `GET /api/system` donne aussi `next` par tâche, `netscan` et `scheduler.beat`.
- **Modifié** : `front/src/tabs/SystemSettings.tsx`, `front/src/tabs/NetworkSettings.tsx`, `front/src/tabs/BackupsSettings.tsx`, `front/src/tabs/Connectors.tsx`, `front/src/tabs/Agents.tsx`, `front/src/lib/tasks.ts` (`parseAt`), `system.py`, `api.py`.
