# Notes de version : MyServices 0.12.0

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.12.0** (17 octobre 2026) : un assistant de démarrage, un agent pour Linux, et des fenêtres de machines plus riches.

## Pour tout le monde

**Quoi de neuf ?**
- **Assistant de démarrage** (page `#assistant`) : six étapes, une décision à la fois, chacune passable et reprenable. Il lit d'abord « cette machine », cherche le réseau, propose la meilleure façon de lire chaque machine (SSH, agent ou connecteur), relie vos outils et règle une alerte. Rien n'est changé sur vos machines, et chaque réglage s'ouvre dans une fenêtre : vous ne quittez jamais la page.
- **Agent pour Linux** : un petit script Python avec son installeur, pour les machines où le SSH est impossible. Il envoie lui-même sa santé, en lecture seule.
- **Home Assistant, mode avancé** : avec l'extension communautaire ha-mcp, MyServices lit la vraie liste des sauvegardes, les réparations, la vérification de la configuration, les extensions et les intégrations en panne.
- **Fenêtre de machine** : la fenêtre d'un appareil UniFi suit le modèle de la Freebox (photo, versions, lecture, clients, réseaux Wi-Fi, firmware). Les conteneurs Docker d'une machine s'affichent avec le logo de leur service, et « Services » ou « N NPM » mènent à l'onglet Services déjà filtré.
- **Machines et Réglages** : une colonne « Sources » avec un badge par source qui lit la machine, des bandes d'en-tête sombres, un guide « Accès aux machines » ouvert depuis un bouton sous le titre.
- **Onglet Santé supprimé** : la santé vit dans l'onglet Machines. Les onglets Infra, Réseau et Sécurité restent cachés tant qu'ils ne sont pas finis.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.12.0` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `access_advice.py` (recommandation de lecture), `front/src/tabs/Assistant.tsx` et ses étapes, `front/src/components/AgentInstall.tsx` et `SetupModal.tsx` (partagés), l'agent Linux.
- **Modifié** : `front/src/tabs/Machines.tsx` (fenêtre UniFi, liste Docker, liens filtrés), `front/src/tabs/MachinesSettings.tsx`, `front/src/lib/tabs.ts` (onglets en chantier).
