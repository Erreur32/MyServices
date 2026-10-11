# Notes de version : MyServices 0.9.2

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.2** (11 octobre 2026) ajoute cinq nouveaux « connecteurs » (MyServices sait lire cinq outils de plus) et améliore la page des agents.

## Pour tout le monde

**Quoi de neuf ?**
- **Proxmox** : MyServices voit vos machines virtuelles et conteneurs (en marche ou arrêtés), l'état de chaque serveur Proxmox, l'espace des stockages et la dernière sauvegarde. **Proxmox Backup Server** : l'espace de vos magasins de sauvegardes et l'âge de la dernière sauvegarde.
- **MynetworK** : MyServices reprend l'inventaire de votre réseau (adresse, fabricant, en ligne ou non). Dans l'onglet Machines, chaque machine montre son adresse MAC et son fabricant, et une liste repliable montre les appareils que MynetworK voit mais que vous ne suivez pas encore.
- **LogviewR** : un nouvel onglet **Fail2ban** apparaît dès que LogviewR est relié : les prisons, les bannissements des dernières 24 heures et les menaces en cours.
- **Dockhand** : vos environnements Docker, le nombre de conteneurs et les mises à jour d'images en attente.
- Une section « Virtualisation et conteneurs » dans l'onglet Santé réunit Proxmox, Proxmox Backup Server et Dockhand.
- **Icônes** pour ces outils, Veeam et Web-Check.
- **Page des agents** : les groupes et chaque carte d'agent se replient (un agent qui va bien est replié d'office, les groupes vides aussi et passent en bas), plus d'espace entre les groupes ; les **agents révoqués** ont leur groupe avec un bouton « Nouvel agent » et un bouton « Supprimer ».
- Réglages → Connecteurs : la page se rouvre sur le dernier sous-onglet utilisé ; un connecteur qui marche n'affiche plus qu'une coche verte, un connecteur en panne montre son message.
- **Correction** : Home Assistant affichait à tort « pas encore lu » alors qu'il était bien lu.

**Ce qu'il faut savoir**
- Les cinq nouveaux connecteurs n'ont été essayés que contre de faux serveurs : dites-nous si quelque chose ne marche pas avec les vrais.
- Il faut créer un jeton de lecture dans chaque outil (le formulaire du connecteur explique où). MyServices ne fait que lire.
- Rien n'est modifié sur vos machines.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.2` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **Connecteurs** (`connectors/`) : `proxmox` et `proxmox-backup` (jeton d'API `PVEAPIToken` / `PBSAPIToken`, rôle d'audit, certificat auto-signé accepté par défaut), `mynetwork` (jeton API `mwk_api_…`, GET seulement), `logviewr` (MCP `POST /mcp`, jeton lecture seule, 5 outils de lecture uniquement), `dockhand` (jeton `dh_…`).
- **Nouveaux apports** : `network`, `security`, `containers`, `virtualization`, écrits dans `data.json`.
- **API** : `DELETE /agents/{id}/purge` (agent déjà révoqué seulement).
- **Correction** : l'état des connecteurs `status` était copié dans `data.json` avant leur lecture.
- **Tests** : 335 Python, 53 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
