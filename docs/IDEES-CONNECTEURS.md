# Idées de connecteurs

Services auto-hébergés courants en homelab ou en réseau local particulier, qui exposent une API de lecture. Classés par famille, avec
ce que MyServices pourrait en tirer. **Rien de tout cela n'est écrit** : c'est une liste de départ pour choisir. Les API sont décrites
de mémoire : **à vérifier dans la documentation du service avant d'écrire le connecteur** (c'est ce que dit la colonne « Certitude »).

Principes (voir [CONNECTEURS.md](CONNECTEURS.md)) : lecture seule, jeton ou compte dédié à créer par l'utilisateur, jamais de secret dans
`data.json`, essai contre un faux serveur d'abord, puis contre le vrai service par l'auteur.

Familles d'apport (`kinds`) déjà là : `inventory`, `services`, `dns`, `health`, `backups`, `logs`, `alerts`, `status`, `network`,
`security`, `containers`, `virtualization`. Nouvelles familles à prévoir : **`cameras`**, **`power`** (onduleurs), **`storage`**
(NAS, pools), **`media`** (médiathèque, téléchargements).

## Par où commencer (ma proposition, dans cet ordre)

| # | Connecteur | Pourquoi |
|---|---|---|
| 1 | **Frigate** (caméras) | Demandé ; API HTTP simple, sans jeton par défaut ; nouvelle famille `cameras` |
| 2 | **OPNsense** (pare-feu) | API REST par clé + secret ; passerelles, interfaces, mises à jour, alias |
| 3 | **CrowdSec** (sécurité) | Complète Fail2ban (LogviewR) : décisions, alertes, scénarios déclenchés |
| 4 | **Pi-hole v6** et **Technitium** (DNS) | Pendants d'AdGuard : requêtes, blocage, état |
| 5 | **TrueNAS** et **Synology DSM** (stockage) | Santé des pools et disques, alertes, espace libre |
| 6 | **Sonarr / Radarr / Prowlarr** (arr) | Clé d'API, même forme pour les trois : état, santé, file d'attente |
| 7 | **UniFi** (réseau + Protect) | Très répandu ; complète MynetworK (qui le lit déjà en partie) |
| 8 | **Tailscale / Headscale** | Machines du réseau privé, en ligne ou non, versions |
| 9 | **NUT** (onduleur) | Batterie, charge, autonomie : un coupure de courant se voit avant les pannes |
| 10 | **Portainer** | Complète Dockhand pour ceux qui l'utilisent |

## Réseau, pare-feu, routeurs

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **OPNsense** | passerelles (en ligne, latence), interfaces, mises à jour du pare-feu, baux DHCP, alias | clé + secret d'API (Basic) | bonne |
| **pfSense** | état, passerelles, interfaces | paquet communautaire « REST API » (pas natif) | moyenne |
| **UniFi Network** (contrôleur, UDM) | sites, appareils, clients, état des liaisons | clé d'API locale | bonne |
| **MikroTik RouterOS** | interfaces, ressources, baux DHCP, passerelles | API REST (RouterOS 7.1+), compte lecture | bonne |
| **OpenWrt** | clients Wi-Fi, charge, mémoire | ubus / rpcd (JSON-RPC), compte dédié | moyenne |
| **Freebox** (Free) | état de la ligne, débits, appareils, redémarrages | API Freebox OS, autorisation de l'application sur la box | bonne (MynetworK en a déjà un greffon) |
| **Fritz!Box** | état de la ligne, appareils | TR-064 (SOAP), compte dédié | moyenne |
| **Tailscale / Headscale** | machines, dernière connexion, version, clés qui expirent | jeton d'API (Tailscale) ; clé d'API (Headscale) | bonne |
| **WireGuard (wg-easy)** | clients, dernier échange, trafic | API de l'interface web | moyenne |
| **Speedtest Tracker** | débit descendant et montant dans le temps, dernier test | jeton d'API | moyenne |

## DNS

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **Pi-hole v6** | requêtes du jour, % bloqué, état du blocage, listes | session par mot de passe d'application | bonne |
| **Technitium DNS** | requêtes, zones, domaines bloqués | jeton d'API | bonne |
| **Blocky** | requêtes, blocage, cache | API HTTP, sans jeton par défaut | moyenne |
| **Unbound / CoreDNS** | pas d'API de lecture utile (métriques Prometheus seulement) | — | à éviter pour l'instant |

## Sécurité

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **CrowdSec** | décisions actives (bannissements), alertes récentes, scénarios | clé d'API locale (LAPI) | bonne |
| **Authentik** | échecs de connexion, événements, utilisateurs actifs | jeton d'API | bonne |
| **Authelia** | santé du service seulement (peu d'API publique) | — | faible |
| **Wazuh** | alertes par gravité, agents déconnectés | API REST par jeton | moyenne |
| **Vaultwarden** | simple vérification de vie (`/alive`) | aucun | bonne mais maigre |

## Caméras, NVR, vidéosurveillance (famille `cameras`)

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **Frigate** | caméras (images par seconde, état), détecteurs (charge, latence), stockage utilisé, derniers événements | API HTTP `/api/stats`, `/api/version`, `/api/events` ; jeton si l'authentification (0.14+) est activée | bonne |
| **go2rtc / Scrypted** | flux actifs, producteurs en erreur | API HTTP | moyenne |
| **UniFi Protect** | caméras en ligne, enregistrements, espace | via le contrôleur UniFi | moyenne |
| **ZoneMinder** | moniteurs en marche, espace | API JSON | moyenne |
| **Shinobi / Blue Iris** | caméras en ligne, enregistrement | API propre à chacun | faible |
| **Reolink, Hikvision, Dahua** (caméras seules) | joignable, enregistre ou non, espace de la carte | API propre à la marque | faible : trop de variantes |

## Stockage et NAS (famille `storage`)

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **TrueNAS** | pools (santé, espace), disques (SMART), alertes, versions | clé d'API (REST v2.0) | bonne |
| **Synology DSM** | volumes, disques (SMART), température, mises à jour, UPS | compte dédié, WebAPI (session) | bonne |
| **Unraid** | tableau, disques, parité, Docker | API GraphQL (Unraid 7) | moyenne |
| **OpenMediaVault** | disques, services | RPC JSON, compte dédié | moyenne |
| **MinIO** | santé, espace, nombre d'objets | clés d'accès, API d'administration | moyenne |
| **Nextcloud** | version, utilisateurs, stockage, mises à jour | jeton « serverinfo » | bonne |
| **Immich / Paperless-ngx** | nombre de médias ou de documents, file de traitement, version | clé ou jeton d'API | bonne |

## Surveillance et conteneurs

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **Prometheus** | cibles en haut ou en bas (`up`), alertes en cours | API HTTP, sans jeton le plus souvent | bonne |
| **Grafana** | santé, alertes en cours | jeton de compte de service | bonne |
| **Netdata** | alarmes actives, charge | API HTTP | bonne |
| **Glances** | CPU, mémoire, disques d'une machine | API REST | bonne |
| **Healthchecks (auto-hébergé)** | jobs en retard ou en échec | clé d'API en lecture | bonne |
| **Portainer** | environnements, conteneurs arrêtés ou en erreur | jeton d'accès | bonne |
| **Traefik** | routeurs, services, erreurs de configuration | API du tableau de bord | bonne |
| **Watchtower** | images mises à jour récemment | API HTTP (si activée) | moyenne |

## Médiathèque et téléchargements (famille `media`)

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **Sonarr, Radarr, Lidarr, Prowlarr, Bazarr** | état, santé (avertissements), file d'attente, manquants | clé d'API (même forme pour tous) | bonne |
| **Jellyfin** / **Plex** | version, sessions en cours, bibliothèques | clé d'API / jeton Plex | bonne |
| **qBittorrent, Transmission, SABnzbd** | torrents ou téléchargements actifs, vitesse, erreurs | API Web UI / RPC | bonne |
| **Overseerr / Jellyseerr** | demandes en attente | clé d'API | bonne |
| **Tautulli** | lecteurs en cours, historique | clé d'API | bonne |

## Énergie et maison (famille `power`)

| Service | Ce qu'on lirait | Accès | Certitude |
|---|---|---|---|
| **NUT** (Network UPS Tools) | charge, batterie, autonomie restante, secteur coupé | protocole NUT (TCP 3493), lecture | bonne |
| **apcupsd** | idem pour les onduleurs APC | protocole propre | moyenne |
| **Zigbee2MQTT / Mosquitto** | passerelle en ligne, appareils sans nouvelles, batteries faibles | MQTT (lecture des sujets d'état) | moyenne |
| **Shelly, Tasmota** | prise ou module en ligne, consommation | HTTP local sans jeton | bonne |

## Canaux de notification à ajouter (pas des connecteurs de lecture)

Les notifications partent aujourd'hui vers Discord, Telegram et un webhook. D'autres canaux se branchent de la même façon
(`alerts.py`, `CHANNELS`) : **ntfy** (simple POST, très répandu en auto-hébergement), **Gotify**, **Pushover**, **Matrix**, **Slack /
Mattermost**, **courriel (SMTP)**.

## Ce qui rend un connecteur facile ou difficile

- **Facile** : API HTTP en lecture, clé ou jeton statique, réponse JSON stable (Frigate, arr, TrueNAS, Prometheus, Pi-hole).
- **Moyen** : session à renouveler (Synology, Pi-hole v6), SOAP (Fritz!Box), autorisation sur l'appareil (Freebox).
- **À éviter pour l'instant** : API sans documentation officielle, ou qui varie trop d'une marque ou d'une version à l'autre (caméras
  seules, pfSense sans paquet), ou qui exigeraient d'écrire sur le service.
