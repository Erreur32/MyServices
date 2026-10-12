<p align="center"><a href="README.md">English</a> · <b>Français</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo-light.png" alt="MyServices" width="380">
  </picture>
</p>

<p align="center">
  <b>L'état de vos services et de vos machines, au même endroit, en lecture seule.</b><br>
  <sub>Il s'appuie sur les outils que vous utilisez déjà. Il ne les remplace pas et n'y écrit jamais.</sub>
</p>

<p align="center">
  <a href="https://github.com/Erreur32/MyServices/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Erreur32/MyServices?label=version&color=3da9fc"></a>
  <img alt="Stade" src="https://img.shields.io/badge/stade-en%20ligne%20%C2%B7%20pr%C3%A9coce-f59e0b">
  <img alt="Lecture seule" src="https://img.shields.io/badge/acc%C3%A8s-lecture%20seule-22c55e">
  <a href="https://github.com/Erreur32/MyServices/pkgs/container/myservices"><img alt="Image Docker" src="https://img.shields.io/badge/image-ghcr.io%2Ferreur32%2Fmyservices-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555">
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml"><img alt="Tests et image Docker" src="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml/badge.svg"></a>
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml"><img alt="Garde-fou" src="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml/badge.svg"></a>
</p>

> ## 🚧 En ligne, mais encore jeune
>
> MyServices est **publié et utilisable**, mais c'est un projet **à un stade précoce** (`0.x`). Les écrans, les réglages et les données
> enregistrées peuvent encore changer d'une version à l'autre, et plusieurs parties n'ont été essayées jusqu'ici que sur un seul PC ou contre
> de faux serveurs (agent Windows, Veeam, Proxmox, Prometheus, Healthchecks, Netdata, Jellyfin, sauvegardes de Home Assistant). **Il ne fait que
> lire vos machines** : l'essayer présente peu de risque, mais laissez-lui du temps avant de vous y fier pour quelque chose de critique :
> gardez une copie de `config/` et `data/` avant chaque mise à jour, et laissez-le sur votre réseau local (jamais directement sur Internet).
>
> Les numéros de version restent **sous la 2.0.0** tant qu'il n'est pas déclaré stable (`0.10.9`, `0.10.10`…).
> Détail : [CHANGELOG.md](CHANGELOG.md) (en anglais) · [RELEASE-NOTES.md](RELEASE-NOTES.md).

## En bref

MyServices rassemble les services de toutes vos machines et de votre réseau local et en montre l'état en direct, **sur une seule page**. Il lit
l'API des outils que vous utilisez déjà (ou la machine elle-même par SSH), recoupe les réponses et vous dit ce qui demande votre attention.

- 🔒 **Lecture seule** : rien n'est écrit sur ce qu'il observe.
- 📦 **Un seul conteneur** : collecte, veille, santé, sauvegardes, comptes, API et page web.
- 🖥️ **Machines** lues par SSH (Linux), par un agent PowerShell (Windows), par une API ou par ping.
- 🔌 **29 connecteurs** : Nginx Proxy Manager, AdGuard Home, Home Assistant, Proxmox, Veeam, UniFi, MynetworK, Beszel…
- 🕘 **Historique** de chaque événement, avec ce qui l'a détecté et ce qui l'a lu.
- 🗺️ **Schémas** générés pour vous (réseau, accès aux machines, sauvegardes, alertes, et d'autres en un clic).
- 🔔 **Alertes et notifications** sur Discord, Telegram et webhook.
- 🤖 Une **API REST** et un **serveur MCP** pour vos outils et assistants IA.

## Démarrage rapide (sur une machine de test)

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo docker-compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/compose.example.yaml
# facultatif : changer le port (8090 par défaut), voir la note plus bas
curl -fsSLo .env https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/env.example && nano .env      # modifier MYSERVICES_PORT
docker compose up -d
docker compose logs myservices        # clé publique de l'app et commande pour l'autoriser sur l'hôte
```

Puis ouvrez **`http://<IP>:8090/`** (l'appli est à la racine du site ; les anciennes adresses `/myservices/…` marchent toujours et redirigent) **dans les 30 minutes** pour créer le compte admin (passé ce délai :
`docker compose restart myservices`), et suivez la carte **« Premiers pas »**, puis la page **Aide** des Réglages.

> **L'application écoute sur le port `8090`.** C'est un réglage, pas une valeur figée : si le 8090 est déjà pris sur votre machine, mettez **`MYSERVICES_PORT=8095`** (ou un autre port libre) dans un fichier `.env` à côté de `docker-compose.yaml` (exemple : [`deploy/env.example`](deploy/env.example), téléchargé par le second `curl` ci-dessus), puis lancez `docker compose up -d` et ouvrez `http://<IP>:8095/`. Le conteneur utilise le réseau de l'hôte : modifier un `ports:` ne servirait à rien.

Image : `ghcr.io/erreur32/myservices` (amd64 et arm64). `:latest` suit le dernier tag, `:0.10.9` une version précise, `:main` le dernier commit de la branche `main` (l'en-tête affiche alors par exemple `v0.10.1+ · main · abc1234`).
Mise à jour : `docker compose pull && docker compose up -d` (réglages et données restent dans les volumes `./config` et `./data`).

---

## En savoir plus

<details>
<summary><b>🔭 Ce que l'on voit : les onglets</b></summary>

| Onglet | Ce qu'il montre |
|---|---|
| **Accueil** | Ce qui demande votre attention (12 lignes par défaut), un paragraphe par onglet, et des compteurs à droite qui ouvrent l'onglet déjà filtré |
| **Historique** | Les événements de 24 h à un an, en points, barres, courbe ou carte de chaleur ; chacun dit ce qui l'a détecté et ce qui l'a lu |
| **Machines** | Chaque machine avec son état, son système, son accès (SSH, agent, API), ses rôles et ses détails ; un PC souvent éteint garde une fiche grisée |
| **Services** | Hôtes NPM et services locaux (Docker, Apache, ports), état, points à vérifier, filtres |
| **Santé** | Processeur, mémoire, disques, SMART, température, services en échec, par machine |
| **Fail2ban** | Bannissements et prisons, dès qu'un connecteur LogviewR est relié |
| **DNS** | AdGuard Home : synchronisation, réécritures, domaines à vérifier |
| **Sauvegardes** | Quels jeux existent, l'âge de la copie la plus récente, où vivent les copies |
| **Schémas** | Schémas générés, plus ceux que vous créez en un clic |
| **Réglages** | Machines, connecteurs, découverte, notifications, sauvegardes, comptes, clé SSH, horaires, API et MCP, aide |

Chaque filtre est un interrupteur : un clic le coupe, un autre le rallume ; plusieurs peuvent être actifs ensemble.

</details>

<details>
<summary><b>🖥️ Comment les machines sont lues</b></summary>

Il y a trois façons de suivre une machine, qui peuvent se combiner. La première source qui répond fait foi et les suivantes complètent (l'ordre se règle machine par machine).

1. **MyServices lui-même**, rien d'autre à installer :
   - **SSH** (Linux) : MyServices se connecte avec **sa propre clé** (montrée dans Réglages -> Clé SSH) et lit la santé, Docker, les services en écoute et les serveurs web. Vous l'autorisez sur chaque machine avec une commande. Un compte dédié non root, dans les groupes `docker` et `adm`, est le plus sûr.
   - **Agent** (Windows) : un petit script PowerShell en lecture seule, installé en tâche planifiée, envoie la santé du PC, ses disques, ses ports, ses services, son matériel et ses conteneurs Docker. Rien à ouvrir côté PC.
2. **Services externes déjà installés sur le réseau** (connecteurs) : si vous faites déjà tourner Beszel, Proxmox, Uptime Kuma, MynetworK… MyServices lit leur API avec une clé en lecture seule. Rien n'est installé sur la machine.
3. **Ping et recherche réseau** : indiquent seulement si une machine est allumée et à quelles applis elle répond. Un balayage discret du réseau local se lance une fois à la main, puis se répète seul. Vous choisissez les machines à suivre ; il n'en ajoute jamais seul.

<details>
<summary><b>🆚 Agent ou services externes ? Ce que l'agent lit déjà</b></summary>

L'agent Windows est un seul petit script. Le tableau montre ce qu'il lit sur un PC et les outils externes qu'il faudrait pour obtenir la même chose. La colonne externe indique ce que ces outils couvrent en général pour cette liste, pas toutes leurs fonctions ; vérifiez leur documentation.

| Ce qui est lu | Agent MyServices (Windows) | Outils externes qui le remplaceraient |
|---|---|---|
| Charge CPU et mémoire | ✅ | Beszel, windows_exporter (Prometheus), Netdata |
| Occupation des disques, par lecteur | ✅ | Beszel, windows_exporter, Netdata |
| Santé des disques physiques | ✅ | Beszel (SMART), windows_exporter |
| Durée de fonctionnement et dernier démarrage | ✅ | Beszel, windows_exporter |
| Ports TCP en écoute et leur programme | ✅ | Peu par défaut ; TCPView à la main |
| Services automatiques arrêtés en erreur | ✅ | windows_exporter, agent Zabbix |
| Erreurs système graves (disque, NTFS, WHEA), 24 h | ✅ | Graylog, Loki avec Alloy, Wazuh |
| Échecs de connexion (nombre, 24 h) | ✅ (compte administrateur) | Wazuh, Graylog, transfert des journaux Windows |
| Mises à jour Windows en attente | ✅ | WSUS, Intune, PDQ Deploy, Lansweeper |
| Redémarrage nécessaire | ✅ | Gestionnaires de correctifs |
| Matériel : fabricant, modèle, BIOS, CPU, cœurs, RAM, GPU | ✅ | GLPI avec FusionInventory, Lansweeper, Snipe-IT |
| Cartes réseau et adresse IPv4 | ✅ (pas d'adresse MAC) | GLPI, Lansweeper ; MynetworK pour la MAC et le fabricant |
| Services en cours | ✅ (jusqu'à 300) | windows_exporter, agent Zabbix |
| Conteneurs Docker du PC : nom, image, ports, état | ✅ | Dockhand ou Portainer (API Docker exposée), Dozzle |
| Présence : allumé, en veille ou muet | ✅ (l'agent se signale lui-même) | Uptime Kuma (ping ou port), MynetworK |
| Installation | Un script, une tâche planifiée, une seule connexion sortante vers MyServices | Un service par outil, son propre compte ou sa clé, un port à ouvrir sur le réseau |

Pour les machines Linux, les mêmes informations viennent de SSH, sans rien installer sur la machine.

</details>

Les machines trouvées mais pas suivies, les clés SSH à autoriser et les agents pas encore installés sont listés dans **Réglages -> Découverte** et comptés dans la cloche de l'en-tête.

</details>

<details>
<summary><b>🔌 Connecteurs (29)</b></summary>

Un connecteur laisse MyServices lire un outil par son API, **en lecture seule** : donnez-lui une clé ou un compte qui ne peut rien modifier. Réglages -> Connecteurs les liste, teste chacun (bouton **Tester**) et montre ce que la dernière collecte a lu. Un tableau **« Services détectés non configurés »** en haut propose ceux qu'il a reconnus sur votre réseau, avec le formulaire déjà rempli.

| Famille | Connecteurs |
|---|---|
| **Web et proxys** | Nginx Proxy Manager, Web-Check |
| **DNS** | AdGuard Home, Pi-hole, Technitium DNS |
| **Supervision** | Beszel, Uptime Kuma, Dozzle, Prometheus, Healthchecks, Netdata, LogviewR |
| **Maison et médias** | Home Assistant, Jellyfin, Sonarr / Radarr / Prowlarr…, Frigate |
| **Réseau** | MynetworK, UniFi Network, Tailscale / Headscale, OPNsense |
| **Sécurité** | CrowdSec |
| **Virtualisation et conteneurs** | Proxmox VE, Dockhand, Portainer |
| **Stockage et sauvegardes** | Proxmox Backup Server, Veeam Backup & Replication, TrueNAS, Synology DSM |
| **Énergie** | Onduleur (NUT) |
| **Canaux** | Discord, Telegram, webhook |

> Les plus récents ont été écrits d'après la documentation de chaque service et **essayés seulement contre de faux serveurs**. MynetworK est le seul utilisé sur un vrai réseau pour l'instant. Dites-nous ce qui ne correspond pas à vos vrais services.

Écrire un connecteur : [docs/CONNECTEURS.md](docs/CONNECTEURS.md). Idées d'autres connecteurs : [docs/IDEES-CONNECTEURS.md](docs/IDEES-CONNECTEURS.md).

</details>

<details>
<summary><b>💾 Sauvegardes</b></summary>

Réglages -> Sauvegardes montre un tableau de **sources** (cliquez sur l'une : ses champs se déplient) :

- **Dossiers sur mes machines** : trouvés par SSH aux endroits habituels (`/home/backup` est suivi automatiquement) ; vous cochez ceux à surveiller.
- **Veeam Backup & Replication** : API REST (port 9419) avec un compte en lecture seule (rôle *Veeam Backup Viewer*) ; vous choisissez les jobs à suivre.
- **Proxmox Backup Server** : groupes de sauvegarde (une VM, un conteneur ou un hôte par magasin) lus avec le jeton du connecteur existant (rôle *DatastoreAudit*).
- **Home Assistant** : sa sauvegarde automatique, avec le jeton du connecteur existant.

Pour chaque sauvegarde suivie, vous fixez l'âge au-delà duquel une alerte part, et si une copie sur une autre machine est exigée. Les tâches cron et timers qui ressemblent à des sauvegardes sont listées à part.

</details>

<details>
<summary><b>🔔 Alertes et notifications</b></summary>

- **Canaux** : Discord, Telegram, webhook.
- **Alertes** : des règles choisissent quels événements (machine hors ligne, santé critique, sauvegarde en retard, nouveau service…) partent sur quel canal, avec un délai pour ne pas répéter la même alerte. Des préréglages aident à démarrer.
- **Notifications** : des messages que vous composez : un **rapport** de machines et de capteurs choisis à heure fixe, ou des **événements en direct** filtrés par type, machine ou texte. Des exemples prêts à l'emploi s'ajoutent en un clic, et « Envoyer maintenant » envoie un vrai message.

Les pannes sont confirmées sur plusieurs passages avant qu'une alerte parte.

</details>

<details>
<summary><b>🗺️ Schémas</b></summary>

Générés avec [Archify](https://github.com/tt-a1i/archify) après chaque collecte : la **carte du réseau**, l'**accès aux machines** (chaque machine sous SSH, agent, connecteur ou aucun accès), les **sauvegardes** et la **chaîne d'alertes**.

L'onglet **Schémas** en propose aussi que vous créez en un clic, construits avec ce que MyServices sait déjà : **équipements et appareils du réseau** (passerelle, switchs, bornes Wi-Fi et ce qui est branché sur chacun, lus par MynetworK et UniFi), **services par machine**, **domaines et leur chemin** (sous chaque NPM et chaque Apache) et **machines virtuelles et conteneurs** (Proxmox).

</details>

<details>
<summary><b>🔐 Sécurité et accès</b></summary>

- **Lecture seule par construction** : les connecteurs n'envoient que des requêtes GET (ou des commandes de lecture par SSH). Mots de passe et jetons sont stockés chiffrés (`enc:v1`) et jamais renvoyés à la page ; la clé SSH privée reste dans `config/ssh` (mode 600) et n'est jamais montrée.
- **Comptes** : comptes locaux (admin ou lecture seule), règles de mot de passe, liste des sessions, journal d'audit (filtrable, export CSV).
- **Réseau** : la page ne répond par défaut qu'aux réseaux privés et à la boucle locale (`MYSERVICES_ALLOW` pour changer). Ne l'exposez pas sur Internet ; passez par un VPN ou un proxy avec authentification pour un accès à distance (`MYSERVICES_COOKIE_SECURE=1` derrière HTTPS).
- **Le conteneur** : l'app tourne sous l'utilisateur `10001` (jamais root). Le conteneur démarre en root seulement le temps de donner `./config` et `./data` à ce compte, puis passe dessus sans plus aucune capacité noyau ; système de fichiers en lecture seule, `no-new-privileges`, pas de socket Docker (l'hôte est lu par SSH comme les autres).
- **Garde-fou avant commit et push** : `bash scripts/install-hooks.sh` refuse jetons, mots de passe, clés, `config.json`, `.env`, bases de données et images non relues.

</details>

<details>
<summary><b>⚙️ Configuration</b></summary>

Presque tout se règle dans la page (Réglages). Fichiers et variables, pour mémoire :

| | |
|---|---|
| `./config` | `config.json`, `services-meta.json`, `secret.key`, `ssh/` (clé de l'app, alias, `known_hosts`) |
| `./data` | la page produite, caches, état, `myservices.db` (comptes, historique, alertes) |
| `MYSERVICES_PORT` | port de la page (défaut `8090`) |
| `MYSERVICES_ALLOW` | réseaux autorisés à ouvrir la page (défaut : réseaux privés et boucle locale) |
| `MYSERVICES_HOST_USER` | compte SSH de l'alias `hote` (la machine hôte) |
| `MYSERVICES_COLLECT_AT` | horaire de la collecte, `minutes heures` (défaut `10,40 *`) ; idem pour la veille et la santé |
| `TZ` | fuseau horaire |

Les horaires se modifient aussi à chaud dans Réglages -> Tâches et horaires. Un exemple complet : [`deploy/compose.example.yaml`](deploy/compose.example.yaml).

</details>

<details>
<summary><b>🤖 API et MCP</b></summary>

Une API REST (`/api/v1/…`, documentation OpenAPI à `/api/v1/docs`) et un **serveur MCP** (`/mcp`, jeton `msv_mcp_`) laissent vos outils et assistants IA lire les mêmes données. Créez des jetons dans Réglages -> API et MCP, avec la durée de validité de votre choix : **read** (par défaut), **runs** (lecture + demander une collecte) ou **admin** (réglages compris ; une durée est obligatoire et votre mot de passe est demandé). Chaque outil MCP a son interrupteur.

</details>

<details>
<summary><b>🧪 Développer</b></summary>

```bash
docker build -t myservices:dev .
docker run --rm --entrypoint python -v $PWD:/src:ro -w /src myservices:dev -m unittest discover -s tests
cd front && npm ci && npm test && npm run dev      # :5180
```

Versions : `python3 scripts/release.py` vérifie que la version, les deux README, le journal des changements et les notes de version sont d'accord ; `release.py patch|minor|X.Y.Z` en applique une nouvelle partout (il ne commit, ne tague et ne pousse rien).
`.claude/` n'est jamais versionné.

</details>

> La documentation complète (installation détaillée, chaque connecteur, API et MCP) sera écrite à mesure que le projet mûrit ; la page **Aide** des Réglages couvre aujourd'hui les premiers pas.
