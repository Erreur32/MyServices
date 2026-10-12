# Notes de version : MyServices 0.11.0

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.0** (12 octobre 2026) : onglet Réseau, une trentaine de connecteurs, Historique plus calme, carte Home Assistant refaite.

## Pour tout le monde

**Quoi de neuf ?**
- **Onglet Réseau** (il n'apparaît que si MynetworK, UniFi, la Freebox, OPNsense ou NetAlertX répondent) : la Freebox et UniFi côte à côte en haut (passerelle, version, équipements en ligne, clients, mises à jour), puis les équipements réseau, les clients rangés par borne ou par switch, et tous les appareils vus sur le réseau. Recherche et filtres comme dans les autres onglets.
- **Nouveaux connecteurs** (Réglages → Connecteurs), proposés tout seuls quand le service est trouvé :
  - supervision : Pulse, Arcane, Glances, GpuViewR, Wazuh, Webmin, Speedtest Tracker, NetAlertX ;
  - statistiques web : Umami, Rybbit ;
  - médias et téléchargement : Tautulli, qBittorrent, Transmission, Bazarr, Overseerr / Jellyseerr, Whisparr ;
  - sauvegardes : Backrest, borgmatic, UrBackup, Veeam pour Microsoft 365, Hyper Backup (Synology), réplications TrueNAS ;
  - virtualisation : Unraid, Proxmox Datacenter Manager ; KVM, Incus / LXD et VirtualBox sont lus par SSH sans rien régler.
- **Agent Windows (version 7)** : il lit aussi Hyper-V, Veeam Agent et la sauvegarde Windows Server. Il se met à jour tout seul si la mise à jour automatique est cochée.
- **Agents reconnus** : un agent (Dozzle, Beszel, Arcane…) n'est plus pris pour un serveur à relier ; sa fiche dit à quel serveur il envoie ses données.
- **Historique plus calme** : les menaces fail2ban, les connecteurs revenus en moins d'une heure et les appareils trouvés par le scan sont masqués par défaut (un clic les réaffiche), et les répétitions sont regroupées.
- **Carte Home Assistant** refaite dans Santé : état et mise à jour en haut, jauges de la machine hôte, entités indisponibles, automatisations, piles faibles.
- **Corrigé** : après avoir enregistré un connecteur (un nouveau jeton par exemple), la page affichait encore l'ancienne erreur jusqu'à 30 minutes. Le connecteur est maintenant relu tout de suite.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.0` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `connectors/homelab_more.py`, `homelab_downloads.py`, `homelab_backups.py`, `homelab_virt.py`, `virt_ssh.py`, `front/src/tabs/Network.tsx`, `front/src/lib/historyNoise.ts`.
- **Modifié** : `known_apps.py` (agents, process, ~40 applis), `agents.py` et `health.py` (agent v7), `api.py` (relecture à l'enregistrement), `connectors/home_assistant.py`, `homelab_infra.py` (TrueNAS, Synology).
- **Essais** : Glances essayé en vrai ; tous les autres contre de faux serveurs construits d'après leur documentation.
- **Tests** : 578 Python, 105 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
