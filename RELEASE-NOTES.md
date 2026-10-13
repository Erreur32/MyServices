# Notes de version : MyServices 0.11.5

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.5** (13 octobre 2026) : versions sur toutes les cartes, AdGuard et connecteurs IA, plus de doublons avec SSH, F5 qui reste sur la page.

## Pour tout le monde

**Quoi de neuf ?**
- **Version de l'application sur les cartes de connecteur** : Dockhand (lue dans son journal des versions), Dozzle, AdGuard Home lu par SSH, et pour les autres celle de leur conteneur quand l'API ne la donne pas.
- **AdGuard Home** s'ajoute maintenant comme les autres connecteurs : par son API (compte de l'interface) ou par SSH. Ceux que vos machines déclarent déjà s'affichent dans « Déjà lus par SSH », avec Proxmox, ESXi, KVM… : rien à ajouter pour eux.
- **Plus de doublons** : « Services détectés non configurés » ne propose plus ce qui est déjà lu par SSH ou déjà couvert par un connecteur ; la liste d'ajout dit « déjà lu par SSH » sur la carte concernée.
- **Connecteurs IA** : Hermes Agent, Ollama et llama.cpp (version, modèles, état), avec leurs icônes.
- **Ajouter un connecteur** : champ de recherche ; « Mes connecteurs » aussi rangés par ordre alphabétique.
- **F5 reste sur la page** : dans Réglages, l'adresse suit la section et le sous-onglet ouverts.
- **Dozzle** : état, version et nombre de conteneurs reliés sur sa carte, étiquette « Docker · journaux ».
- **Pas encore lu** : un connecteur qui attend sa première lecture dit quand passe la prochaine collecte.
- **Icônes noires** (Umami, Rybbit, Hermes…) affichées en blanc dans le thème sombre.
- **Nouveaux services** : le SSH de la machine (OpenSSH) n'est plus proposé.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.5` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `connectors/homelab_ai.py` (Hermes, Ollama, llama.cpp), `api_link.app_version()` (version du conteneur derrière l'adresse d'un connecteur).
- **Modifié** : `connectors/adguard.py` (modes API / SSH, version par l'étiquette de l'image), `connectors/dockhand.py`, `connectors/dozzle.py`, `connectors/settings.py`, `myservices.py` (versions, propositions sans doublon), `api.py`, `front/src/tabs/Connectors.tsx`, `front/src/tabs/Settings.tsx`, `front/src/lib/settingsNav.ts`.
