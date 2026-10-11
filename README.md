# MyServices ![BETA](https://img.shields.io/badge/version-BETA-orange)

> **BETA : MyServices v2 (Docker) est en test.** Il lit vos machines en **lecture seule** et sert déjà au quotidien, mais :
> les écrans et les réglages peuvent encore changer d'une version à l'autre, l'agent Windows (PowerShell) n'a été validé que sur un PC,
> et l'assistant Veeam comme les sauvegardes de Home Assistant n'ont été essayés que sur de faux serveurs. Gardez une copie de
> `config/` et `data/` avant chaque mise à jour, et signalez ce qui ne va pas (issues GitHub).
> Numérotation : tant que le projet est en BETA, les versions restent **sous la 2.0.0** (`0.0.1`, `0.1.0`…) ; la **2.0.0** ne sortira
> que lorsque MyServices v2 sera jugé stable. Exemple d'image : `ghcr.io/erreur32/myservices:0.0.1`. L'étiquette `:latest` suit le dernier
> tag publié ; pour rester sur une version précise, utilisez son numéro. L'étiquette `:docker` suit la branche, donc le dernier état,
> sans promesse de stabilité. Les anciennes préversions `2.0.0-alpha.N`, `-beta.N` et `-rc.N` restent disponibles mais ne sont plus suivies.
> Détail des versions : [CHANGELOG.md](CHANGELOG.md) ; dernière mise à jour expliquée simplement : [RELEASE-NOTES.md](RELEASE-NOTES.md).

Annuaire de tous les services d'un réseau local, avec leur état en direct : `hosts Nginx Proxy Manager`,
`conteneurs Docker`, `process en écoute`, `services ajoutés à la main`, `contrôle DNS AdGuard Home`.
Le but est de donner l'état du réseau, pas de faire du monitoring : un passage toutes les 30 min,
avec peu de sondes.

Tout se fait en **lecture seule**. Seule la bibliothèque standard de Python 3 est utilisée : pas de pip, pas de PyYAML.

## Installation Docker (v2 BETA)

Un seul conteneur fait tout : collecte, veille, santé, sauvegardes et page sur `:8090/myservices/`.
Plus de timers systemd, ni de config nginx ou Apache à écrire (la page se met derrière NPM comme un
autre service).

**Nouvelle installation** (image publiée, sans cloner le dépôt) : [`deploy/compose.example.yaml`](deploy/compose.example.yaml).
Un service `init` donne `./config` et `./data` au compte de l'app (10001) avant chaque démarrage : rien à
préparer à la main.

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/docker/deploy/compose.example.yaml
docker compose up -d
docker compose logs myservices        # clé publique de l'app et commande pour l'autoriser sur l'hôte
```

Puis, dans les 30 minutes, ouvrir `http://<IP>:8090/myservices/v2/` : créer le compte admin, puis
**Réglages → Machines** (ajouter chaque machine : détection SSH, Docker, AdGuard) et **Connecteurs**
(NPM, Beszel, Uptime Kuma…).

**Depuis une installation classique**, ou pour développer (dépôt cloné, image construite sur place) :

```bash
git clone -b docker https://github.com/Erreur32/MyServices.git && cd MyServices
# Depuis une installation classique (config, secrets, clés et alias SSH repris ; l'original n'est pas touché) :
sudo python3 import_install.py --to ./dev-data/config --public-url http://<IP>:8090/myservices/
docker compose up -d --build
docker compose logs myservices        # clé publique de l'app et commande pour l'autoriser sur l'hôte
docker compose exec myservices python3 setup.py --check
```

<details>
<summary>Volumes, machine hôte, sécurité, retour en arrière</summary>

- **`/config`** (`./config` avec l'exemple, `./dev-data/config` dans le dépôt) : `config.json`, `services-meta.json`, `backups-meta.json`, secrets
  (`secrets/`), clés et alias SSH (`ssh/`). Verrouillé à chaque démarrage : dossiers 700, fichiers 600.
  **`/data`** (`./data`, ou `./dev-data/data`) : fichiers produits (`data.json`, `events.json`, `health/`), état,
  caches, `myservices.db` (comptes, historique, alertes). Les deux appartiennent au compte 10001 (service `init`
  de l'exemple ; à la main : `sudo chown -R 10001:10001 config data`).
- **Machine hôte** : le conteneur n'a pas le socket Docker (il donnerait les droits root sur l'hôte). Il
  lit l'hôte **par SSH**, alias `hote`, comme les autres machines. Au premier démarrage, il crée sa clé
  (`/config/ssh/myservices`) et affiche dans son journal la ligne à ajouter dans `authorized_keys` de l'hôte.
- **Sécurité** : compte sans droits (10001), système de fichiers en lecture seule, `cap_drop: ALL`,
  `no-new-privileges`, page et API réservées aux réseaux privés (`MYSERVICES_ALLOW` pour restreindre).
- **Horaires** : ceux de l'installation classique ; `MYSERVICES_COLLECT_AT="10,40 *"` (minutes, heures),
  de même `_WATCH_AT`, `_HEALTH_AT`, `_BACKUPS_AT`.
- **NPM** : l'import remplace `npm-api.sh` par l'API directe de NPM (compte repris de `npm-api.conf`).
- **Comptes** : la page demande une connexion. **Premier compte** : à la première visite, la page propose de
  créer le compte admin (seulement tant qu'aucun compte n'existe, depuis le réseau local, dans les 30 minutes
  qui suivent le démarrage ; au-delà, redémarrer le conteneur). Les autres comptes (`viewer` : lecture et
  bouton ⟳) : `docker compose exec myservices python3 manage.py add <nom> [admin|viewer]` ; aussi
  `users`, `password <nom>`, `delete <nom>`, `audit`. Mots de passe en argon2id, session par cookie
  `HttpOnly` + `SameSite=Strict`, jeton CSRF sur toute action, 10 échecs par IP = 15 min de blocage.
  Derrière NPM en HTTPS : `MYSERVICES_COOKIE_SECURE: "1"`. Comptes coupés : `MYSERVICES_AUTH: "0"` (déconseillé).
- **Secrets** : `docker compose exec myservices python3 manage.py encrypt-secrets` chiffre mots de passe,
  jetons et webhooks de `config.json` (clé : `/config/secret.key`, à sauvegarder avec `/config`).
- **API** : `/myservices/api/v1/` (doc : `/myservices/api/v1/docs`, après connexion).
- **Commandes** : `docker compose exec myservices python3 setup.py` (`--check`, `--add <IP|alias>`).
- **Retour à l'installation classique** : `docker compose down` ; l'installation d'origine n'a pas été
  modifiée par l'import. Pour retirer la classique une fois la v2 validée : `sudo ./install.sh --uninstall`
  (sauvegarde d'abord, ne retire que les unités et extraits web de son propre dossier).
- **Non-régression** : `python3 tests/compare_data.py <ancien>/data.json <nouveau>/data.json` ; tests :
  `python3 -m unittest discover -s tests`.

</details>

## Installation rapide (classique, systemd)

```bash
git clone https://github.com/Erreur32/MyServices.git /opt/myservices
cd /opt/myservices
sudo python3 setup.py      # questions : NPM, URL, alertes (Discord, Telegram), machines détectées via ~/.ssh/config
sudo ./install.sh          # systemd + nginx ou Apache + premier passage
```

L'installation se fait **en place** : le dossier cloné reste celui du programme. Pour mettre à jour :
`git pull && sudo ./install.sh`. `./install.sh --help` liste les options (horaires, utilisateur, réseau,
`--apache`, `--no-web`, `--no-watcher`, `--dry-run`, `--uninstall`…).

## Installation pas à pas

Seules les étapes 1, 5, 6, 7 et 9 sont indispensables. Les autres ajoutent une source (machines Linux
par SSH, NPM, Veeam) : elles peuvent venir plus tard, `setup.py` se relance sans rien perdre.

1. **Cloner** dans `/opt/myservices` (un dossier sous `/home` est souvent illisible pour le serveur web).
2. **SSH vers les machines Linux** (facultatif : conteneurs, ports, santé) :
   - sur la collectrice, en root, une clé sans phrase de passe :
     `sudo ssh-keygen -t ed25519 -N '' -C myservices -f /root/.ssh/myservices` ;
   - sur chaque machine, un compte dans les groupes `docker` et `adm` (existant, ou dédié : bloc 2) ;
   - poser la clé **sur ce compte** : `sudo ssh-copy-id -i /root/.ssh/myservices.pub <compte>@<ip>`
     (sans `<compte>@`, c'est root qui est visé) ;
   - un alias dans `/root/.ssh/config` : `Host`, `HostName` = l'IP, `User` = le compte (bloc 1) ;
   - test : `sudo ssh <alias> whoami` répond le compte, sans rien demander.
   Windows, ESXi, box, NAS sans SSH : rien à faire, ils seront suivis au ping.
3. **NPM** (facultatif) : [`npm-api.sh`](https://github.com/Erreur32/nginx-proxy-manager-Bash-API) installé
   et testé (`npm-api.sh --info`). `setup.py` demandera son chemin (bloc 3).
4. **Veeam Backup & Replication** (facultatif) : sur son serveur Windows, port **9419** ouvert pour la
   collectrice et un compte au rôle **Veeam Backup Viewer** (bloc 7).
5. **`sudo python3 setup.py`**, dans l'ordre :
   - réglages : URL de la page (avec le port du serveur web et le `/` final), webhook Discord, bot Telegram, santé ;
   - machines : collectrice, passerelle, chaque alias SSH ; AdGuard Home détecté (Docker ou natif) ;
     puis recherche des autres machines du réseau (toutes, ou seulement les IP données ; touche `q`) ;
   - NPM : chemin de `npm-api.sh` (Entrée s'il est proposé) ;
   - sauvegardes : Veeam (serveur, compte, jobs à suivre) ; Proxmox, tar, rsync : à la main (bloc 7).
6. **`sudo python3 setup.py --check`** : chaque ⚠ donne la commande qui le corrige (règle sudoers SMART ou
   AdGuard, groupe docker, clé d'hôte…). Relancer jusqu'à « ✓ prêt ».
7. **`sudo ./install.sh`** : timers, serveur web (nginx s'il est là, sinon Apache), premier passage.
   Page déjà servie par une config faite à la main : `--no-web`.
8. **nginx seulement** : `include snippets/myservices.conf;` dans le bloc `server` voulu, puis
   `nginx -t && systemctl reload nginx`. Apache : rien à faire.
9. **Vérifier** : `systemctl list-timers 'myservices*'` (collecteur, watcher, santé, sauvegardes), la page,
   le bouton ⟳.
10. **Affiner `services-meta.json`** (pris en compte au passage suivant) : `"off": true` sur les PC
    souvent éteints (sinon une alerte à chaque extinction ; demandé par `setup.py` pour les machines
    trouvées sur le réseau, à la main pour celles déjà déclarées), services des machines sans SSH dans `extra`
    (web 80 / 443 et Plex 32400 proposés par `setup.py` à l'ajout, les autres à la main),
    `"vm": true` à retirer d'une machine physique (SMART), `"health": false` pour l'exclure de la santé.

`config.json` ne contient que les valeurs différentes des défauts : un fichier court est normal.

**Ajouter ou reprendre une seule machine** : `sudo python3 setup.py --add 192.168.0.4` (IP, nom ou alias
SSH ; sans argument, il demande). Toutes les détections sur cette machine seule (ping, ports, SSH Linux ou
**Windows reconnu tout seul**, docker, AdGuard, VM, souvent éteinte, services web), puis sa vérification ;
`config.json` et les autres machines ne sont pas touchés. Machine déjà déclarée (alias ajouté depuis,
Windows équipé d'OpenSSH) : la détection est reprise, nom, rôle et réglages gardés.

**Mise à jour** : `git pull`, puis `sudo python3 setup.py` s'il y a de nouvelles machines, un nouvel
AdGuard ou de nouveaux jobs Veeam (seuls les nouveaux sont proposés), puis `sudo ./install.sh` (avec
`--no-web` si la page est servie à la main).

## Composants

| Fichier          | Rôle                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `myservices.py`  | collecteur : lit NPM, docker (local ou SSH), `ss -tlnp`, sonde les services, écrit `web/data.json`                         |
| `hostinfo.py`    | infos machines par SSH (OS, sshd, Docker, vhosts Apache), lu par le collecteur                                             |
| `health.py`      | santé des machines (disque, systemd, Docker, maj, noyau, charge, échecs SSH, SMART), sans LLM, écrit `web/health/`             |
| `backups.py`     | veille sauvegardes (facultatif) : archives, copies, crons et disques de chaque machine, écrit `web/backups.json` |
| `watcher.py`     | compare `data.json` au passage précédent : pannes, nouveaux services, sécurité, DNS, puis `web/events.json` et les alertes |
| `refresh-api.py` | petite API du bouton ⟳ de la page (déclenche un passage via systemd)                                                       |
| `config.py`      | lecture de `config.json` et des variables d'environnement                                                                  |
| `setup.py`       | assistant de configuration (questions + détection), et `--check` pour tester une config existante                         |
| `install.sh`     | installation systemd + nginx ou Apache à partir des gabarits de `deploy/`|
| `web/`           | la page (statique), servie par nginx ou Apache |
| `deploy/`        | gabarits des unités systemd et des extraits nginx / Apache |

## Configuration

Deux fichiers locaux, non versionnés (`.gitignore`), en mode 600 : `config.json` (chemins, URL, délais, et
les **secrets** : mots de passe NPM, webhooks) et `services-meta.json` (machines, catégories, surcharges).

`sudo python3 setup.py` les écrit en posant des questions, et se relance sans risque : les valeurs actuelles
sont proposées par défaut et un `services-meta.json` existant est seulement complété. Après les alias de
`~/.ssh/config`, il peut chercher les autres machines du réseau (ping du /24, indices : SSH, Windows, NAS,
Veeam…) et les ajouter sans inventaire (`"ssh": null`). Pour ne pas tout parcourir, donner seulement leurs
IP (`192.168.0.4 192.168.0.10-20`). Les machines déjà dans `services-meta.json` ne sont ni testées ni
reproposées. Touche **q** (sans Entrée, annoncée à l'écran) : arrête la recherche ; `q` en réponse arrête la
liste des propositions. Les machines déjà trouvées ou ajoutées sont gardées, la configuration continue.

<details>
<summary>Machines sans SSH (Windows, NAS, box) : ce qui est suivi</summary>

| Suivi | Comment |
|---|---|
| en ligne / hors ligne | ping à chaque passage, alerte si elle tombe |
| ses services | seulement ceux déclarés dans `extra` : `{"ip": "192.168.0.4", "port": 80, "name": "Interface web"}` (`"scheme": "https"` au besoin), sondés à chaque passage |
| ses sauvegardes | par la source qui les produit (API Veeam, NAS), voir le bloc 7 |
| conteneurs, ports en écoute, santé | non : passent par SSH et des commandes Linux |

PC souvent éteint (poste de jeu, portable) : `"off": true` sur la machine, affichée « machine éteinte »
sans alerte tant qu'elle ne répond pas. Le rôle (`role`) est un texte libre affiché sous le nom.

</details> Il détecte la
machine locale, la passerelle, chaque hôte de `~/.ssh/config` (SSH joignable, accès docker) et, d'après
les conteneurs, NPM, AdGuard Home et adguardhome-sync. `sudo python3 setup.py --check` refait seulement
les tests. On peut aussi partir des exemples : `config.example.json` et `services-meta.example.json`.

### `config.json`


<details>
<summary>Toutes les clés, valeurs par défaut et variables d'environnement</summary>

Les clés absentes prennent la valeur par défaut définie dans `config.py`. Chaque clé peut être surchargée
par une variable `MYSERVICES_<CLÉ>`, par exemple `MYSERVICES_DISCORD_WEBHOOK=...`. Pour lire un autre
fichier : `MYSERVICES_CONFIG=/chemin/config.json`. Les chemins relatifs partent du dossier du projet.

| Clé                                                  | Défaut                      | Rôle                                                                                                                                                   |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm`                                                | vide                        | instance(s) Nginx Proxy Manager (facultatif : vide = pas de NPM), lues par l'API REST (GET seulement) : `{"name", "url", "user", "password"}`. Variantes : `"ssh": "alias"` si l'admin n'écoute que sur 127.0.0.1 d'une machine distante (curl par SSH, secrets par stdin), ou `"api": "/chemin/npm-api.sh"`. Détail dans `npmapi.py` |
| `npm_api`                                            | vide                        | ancien format : chemin de [`npm-api.sh`](https://github.com/Erreur32/nginx-proxy-manager-Bash-API) (une seule instance)
| `meta`                                               | `services-meta.json`        | inventaire des machines                                                                                                                                |
| `web_dir`                                            | `web`                       | dossier servi par le serveur web, où sont écrits `data.json` et `events.json`                                                                                   |
| `cache_dir`                                          | `~/.cache/myservices`       | caches SSH et docker du collecteur                                                                                                                     |
| `state_dir`                                          | `~/.local/state/myservices` | état du watcher                                                                                                                                        |
| `sshlist`                                            | vide                        | script sshlist optionnel (accès SSH et notes en plus de `~/.ssh/config`)                                                                               |
| `public_url`                                         | vide                        | URL de la page, ajoutée aux alertes                                                                                                                    |
| `collector_name`                                     | hostname                    | nom de la machine collectrice dans les alertes                                                                                                         |
| `discord_webhook`                                    | vide                        | webhook Discord du watcher (vide = pas d'envoi)                                                                                                        |
| `docker_cache_ttl` / `ssh_cache_ttl` / `cache_slack` | 7200 / 1800 / 300           | durées de cache (s)                                                                                                                                    |
| `probe_timeout`                                      | 4                           | délai des sondes TCP et HTTP (s)                                                                                                                       |
| `dns_qps`                                            | 8                           | requêtes DNS/s par AdGuard. Le `ratelimit` d'AdGuard (20/s par défaut) est **partagé par tout le /24** : ne pas monter                                 |
| `stale_min`                                          | 75                          | au-delà (min), `data.json` est considéré périmé (alerte)                                                                                               |
| `confirm_runs`                                       | 2                           | nombre de passages consécutifs avant d'annoncer une panne ou un rétablissement                                                                         |
| `retention_days`                                     | 90                          | durée de l'historique                                                                                                                                  |
| `health_url`                                         | vide                        | `health/` = santé intégrée (`health.py`, installé par `install.sh` toutes les 6 h). Autre URL = health-watcher externe au même format. Vide = onglet Health et colonnes Disque / Systemd / Maj masqués |
| `health_webhook`                                     | vide                        | webhook Discord de `health.py` (vide = `discord_webhook`) |
| `telegram_token` / `telegram_chat_id`                | vide                        | bot Telegram des alertes (watcher et santé), en plus de Discord ; les deux vides = pas d'envoi |
| `backups_url`                                        | vide                        | `backups.json` = `backups.py` intégré ; autre URL = script de sauvegardes externe au même format. Vide = onglet Backups masqué |
| `backups_meta`                                       | `backups-meta.json`         | inventaire des sauvegardes de `backups.py` (absent = pas installé) |
| `links`                                              | vide                        | liens ajoutés en tête et en pied de page : `[{"label": "Portail", "url": "../"}]` |

</details>

### `services-meta.json`

`machines` : pour chaque IP, `name`, `role`, `ssh` (alias de `~/.ssh/config`, `"local"` pour la machine
collectrice, `null` pour ne pas faire d'inventaire), plus des drapeaux facultatifs : `npm`, `gateway`,
`adguard` (nom du conteneur), `adguard_sync` (détecté seul, `false` pour l'ignorer), `off` (machine éteinte volontairement), `npm_only`.
La description complète des clés se trouve dans le champ `_doc` du fichier exemple.

## Bilan des réglages à faire

Chaque bloc se déplie. Règle générale : **une clé vide désactive son service** (onglet masqué, pas d'envoi,
pas de lecture), sans erreur. NPM compris : sans instance, l'annuaire montre les conteneurs, les process
et les services manuels.

| Service | Réglage | Login / jeton | Si vide |
|---|---|---|---|
| Nginx Proxy Manager | `npm` → `"api": "…/npm-api.sh"` | e-mail + mot de passe NPM dans `npm-api.conf` | pas de hosts NPM, groupe NPM masqué |
| Docker (chaque machine) | `machines.<ip>.ssh` | clé SSH, groupe `docker` | pas d'inventaire docker pour la machine |
| Process en écoute | `process_hosts` | clé SSH (root pour les noms de process) | pas de process hors docker |
| AdGuard Home | `machines.<ip>.adguard` | aucun (lecture par `docker exec`) | pas de contrôle des réécritures |
| adguardhome-sync | **détecté seul** ; `"adguard_sync": false` pour l'ignorer | aucun (lecture par `docker logs`) | AdGuard comparés entre eux seulement |
| Alertes du watcher | `discord_webhook` | URL du webhook (secret) | pas d'envoi (sortie standard seulement) |
| Santé des machines | `health_url` = `health/` | clé SSH, `adm`, sudoers `smartctl` | onglet Health masqué, `health.py` non installé |
| Alertes santé | `health_webhook` | URL du webhook (secret) | `discord_webhook` utilisé |
| Alertes Telegram | `telegram_token` + `telegram_chat_id` | jeton du bot (secret) | pas d'envoi Telegram |
| Sauvegardes | `backups-meta.json` + `backups_url` = `backups.json` (bloc 7) | clé SSH ; jeton HA ; compte Veeam Backup Viewer | `backups.py` non installé, onglet Backups masqué |
| sshlist | `sshlist` | aucun | seul `~/.ssh/config` est lu |
| Liens de la page | `links` | aucun | pas de liens |

<details>
<summary><b>1. Machine collectrice</b> : root, clé SSH, alias</summary>

Le collecteur tourne en **root** (`ss -tlnp` avec les noms de process, docker local). Les connexions SSH
partent donc de `/root/.ssh/`, en `BatchMode` : clé **sans phrase de passe**, aucune question possible.

```bash
# une clé dédiée, sur la collectrice, une seule fois
sudo ssh-keygen -t ed25519 -N '' -C myservices -f /root/.ssh/myservices
```

Puis, pour chaque machine, poser la clé sur **le compte choisi au bloc 2** :

- compte **existant** (avec un mot de passe) : `sudo ssh-copy-id -i /root/.ssh/myservices.pub <compte>@<ip>` ;
- compte **dédié** créé sans mot de passe : `ssh-copy-id` ne peut pas s'y connecter. Afficher la clé sur la
  collectrice (`sudo cat /root/.ssh/myservices.pub`), puis sur la machine :

```bash
sudo install -d -m 700 -o myservices -g myservices /home/myservices/.ssh
echo 'ssh-ed25519 AAAA… myservices' | sudo tee /home/myservices/.ssh/authorized_keys   # la ligne affichée
sudo chown myservices: /home/myservices/.ssh/authorized_keys && sudo chmod 600 /home/myservices/.ssh/authorized_keys
```

Un alias par machine dans `/root/.ssh/config`. `HostName` doit être l'**IP** utilisée dans
`services-meta.json` (c'est par elle que la machine est rattachée à son alias) :

```sshconfig
Host nas
    HostName 192.168.1.30
    User myservices
    IdentityFile /root/.ssh/myservices
    IdentitiesOnly yes
```

Test : `sudo ssh -o BatchMode=yes nas true` doit rendre la main sans rien demander. Puis
`sudo python3 setup.py --check`. La machine collectrice elle-même se déclare avec `"ssh": "local"`.

</details>

<details>
<summary><b>2. Machines distantes</b> : compte SSH, docker, sudoers, journal</summary>

**Quel compte ?** Pas obligatoirement un nouveau : un compte existant de la machine convient, s'il est dans
les groupes `docker` et `adm`. Un compte **dédié** est plus sûr : sans mot de passe, il ne sert qu'à
MyServices, et sa clé peut être révoquée seule. Le groupe `docker` vaut un accès root, donc mieux vaut ne
pas le donner à un compte d'usage courant qui ne l'a pas déjà. Pour un compte dédié, sur chaque machine :

```bash
sudo adduser --disabled-password --gecos "" myservices   # pas de mot de passe : connexion par clé seulement (bloc 1)
sudo usermod -aG docker myservices   # conteneurs, réseaux, AdGuard, adguardhome-sync, docker stats
sudo usermod -aG adm myservices      # health.py : échecs SSH et erreurs noyau (journalctl)
```

**Docker : groupe, pas sudoers.** Toutes les commandes sont lancées en `docker …`, jamais en `sudo docker …` :
une règle sudoers pour docker ne sert donc à rien, c'est le groupe `docker` qu'il faut. Ce groupe vaut un
accès root sur la machine : réservez-le à ce compte dédié, avec une clé qui ne sert qu'à lui. Commandes utilisées :
`docker ps -a`, `docker network ls` / `inspect`, `docker stats --no-stream`,
`docker exec <adguard> cat /opt/adguardhome/conf/AdGuardHome.yaml`, `docker logs --since 24h <adguard_sync>`.

**Sudoers : seulement pour SMART** (`health.py`). Chemin absolu obligatoire, la session SSH n'a pas
`/usr/sbin` dans son `PATH`. Lister les disques **un par un** (`lsblk -d`, et pour un NVMe le contrôleur
`/dev/nvme0`, pas `nvme0n1`) : jamais `/dev/*`, car dans sudoers `*` couvre aussi des options en plus
(`-s off`…). `sudo python3 setup.py --check` affiche la règle exacte de chaque machine :

```bash
echo 'myservices ALL=(root) NOPASSWD: /usr/sbin/smartctl -H /dev/sda, /usr/sbin/smartctl -H /dev/nvme0' \
  | sudo tee /etc/sudoers.d/myservices-smart-health
sudo chmod 440 /etc/sudoers.d/myservices-smart-health
sudo visudo -cf /etc/sudoers.d/myservices-smart-health    # vérifie la syntaxe
```

Sur une VM ou un conteneur, inutile : `"vm": true` (posé par `setup.py`) désactive SMART.

**Autres ressources lues** (lecture seule, sans sudo) :

| Ressource | Pour | Réglage si refusé |
|---|---|---|
| `/etc/apache2/sites-enabled/*.conf`, `ports.conf` | vhosts Apache | `sudo setfacl -m u:myservices:r /etc/apache2/sites-available/*.conf` |
| `/etc/ssh/sshd_config` (+ `.d/`) | sécurité sshd (port, root, mot de passe) | lisible par tous sous Debian |
| `ss -tlnpH` (`process_hosts`) | ports et process hors docker | les noms des process d'autres comptes ne sont visibles qu'en root : alias en `User root` pour ces machines, ou ports sans nom |
| `apt list --upgradable`, `systemctl --failed`, `lsblk` | `health.py` | rien à faire |

</details>

<details>
<summary><b>3. Nginx Proxy Manager</b> : via <code>npm-api.sh</code> (facultatif)</summary>

Sans NPM (`npm` vide), rien à faire : l'annuaire liste les conteneurs, les process et les services
manuels, le contrôle AdGuard ne porte que sur les réécritures. Avec NPM :

MyServices lit NPM avec [`npm-api.sh`](https://github.com/Erreur32/nginx-proxy-manager-Bash-API) :
le script gère le jeton (création, cache, renouvellement) et les identifiants restent dans **son** fichier,
pas dans `config.json`. Seules des listes sont lues (`--host-list`, `--redirect-host-list`,
`--dead-host-list`, `--stream-host-list`, `--access-list`, toujours avec `--json`).

```bash
sudo mkdir -p /opt/npm-api && cd /opt/npm-api
sudo wget https://raw.githubusercontent.com/Erreur32/nginx-proxy-manager-Bash-API/main/npm-api.sh
sudo chmod 700 npm-api.sh
sudo apt install curl jq
```

`/opt/npm-api/npm-api.conf`, à côté du script, en mode 600 (root, comme le collecteur) :

```bash
NGINX_IP="192.168.1.10"      # IP de NPM : sert aussi au contrôle DNS (IP attendue en LAN)
NGINX_PORT="81"              # port de l'admin
API_USER="admin@exemple.fr"  # compte de l'interface d'admin NPM
API_PASS="motdepasse"
```

Test : `sudo /opt/npm-api/npm-api.sh --info`, puis `sudo /opt/npm-api/npm-api.sh --json --host-list | jq length`.

**`setup.py` demande toujours son chemin**, pré-rempli s'il le trouve (PATH, `/opt/*/`, `/usr/local/bin/`,
`/root/*/`, `/home/*/…` jusqu'à 3 niveaux) : Entrée = celui trouvé, sinon taper le chemin, `n` = aucun.
Le script est testé tout de suite ; aucun identifiant NPM n'est alors demandé. Les identifiants de
l'admin ne servent que si l'on n'a pas `npm-api.sh` (ajout à la main, accès 2 ou 3). À la main, dans `config.json`, une entrée par instance
(un dossier `npm-api.sh` + `npm-api.conf` par instance) :

```json
"npm": [
  {"name": "lan", "api": "/opt/npm-api/npm-api.sh"},
  {"name": "vps", "api": "/opt/npm-api-vps/npm-api.sh", "ip": "203.0.113.5"}
]
```

`ip` est facultatif : sinon il est lu dans `NGINX_IP`. Les deux autres formes (`url` + `user` +
`password` dans `config.json`, avec `ssh` en plus si l'admin n'écoute qu'en local) restent possibles.
Un compte NPM dédié suffit : seules des lectures sont faites.

</details>

<details>
<summary><b>4. AdGuard Home et adguardhome-sync</b></summary>

Rien à créer côté AdGuard : pas de login, pas de jeton.

`sudo python3 setup.py` **le détecte seul** sur la collectrice et sur chaque machine avec SSH, et propose
de le suivre :

- **Docker** (image `adguard/adguardhome`) : `"adguard": "<nom du conteneur>"`, `AdGuardHome.yaml` lu par
  `docker exec`. Il faut le groupe `docker` sur la machine.
- **Installation native** (script officiel : `/opt/AdGuardHome/`, ou snap) : `"adguard": "<chemin de
  AdGuardHome.yaml>"`, lu par `cat`. Sur la collectrice (root), rien à faire. Sur une autre machine, le
  fichier est réservé à root : `setup.py --check` donne la règle sudoers exacte, limitée à ce fichier
  (`<compte> ALL=(root) NOPASSWD: /usr/bin/cat /opt/AdGuardHome/AdGuardHome.yaml`).
- Le port de l'interface web (3000, 80, 800…) n'intervient pas : seuls le fichier et le DNS (port 53) servent.
- AdGuard dans la box, dans Home Assistant ou sur une machine sans SSH : pas lisible.
- Chaque domaine NPM est demandé à chaque AdGuard par une requête DNS directe : **UDP 53** ouvert depuis
  la collectrice. Garder `dns_qps` ≤ 8 (limite AdGuard partagée par tout le /24).
- Clé `adguard` absente : la machine n'est pas interrogée.

**Synchronisation entre instances**, trois cas gérés seuls :

| Cas | Ce qui est affiché |
|---|---|
| un seul AdGuard | « instance unique », rien à synchroniser |
| plusieurs, sans adguardhome-sync | réécritures et règles perso comparées : les écarts sont listés par instance |
| plusieurs, avec adguardhome-sync | en plus : origine → répliques, dernière synchro, erreurs 24 h, prochaine synchro prévue |

adguardhome-sync est **détecté seul** dans l'inventaire docker de chaque machine (image ou nom
`adguardhome-sync`). Son journal (`docker logs --since 24h`) donne l'origine (`from`), les répliques
(`to`) et la fréquence (intervalle médian entre deux synchros) : pas besoin de déclarer le maître, les
esclaves ni le cron. Une synchro est « en retard » au-delà de cette fréquence + 25 %. Sa config (qui
contient les mots de passe AdGuard) n'est jamais lue. `"adguard_sync": "<nom>"` force un conteneur,
`"adguard_sync": false` l'ignore.

</details>

<details>
<summary><b>5. Alertes Discord et Telegram</b> : <code>discord_webhook</code>, <code>health_webhook</code>, <code>telegram_*</code></summary>

Sur Discord : *Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL*.
L'URL donne le droit d'écrire dans le salon : à garder dans `config.json` (mode 600), ou dans
l'environnement (`MYSERVICES_DISCORD_WEBHOOK=…`) via un `systemctl edit myservices-watcher.service`.

- `discord_webhook` vide : le watcher n'envoie rien, il écrit seulement le résumé sur sa sortie standard.
- `health_webhook` vide : `health.py` utilise `discord_webhook` ; les deux vides, pas d'alerte santé.

Telegram (en plus de Discord ou à sa place, mêmes alertes, texte brut) : créer un bot avec
[@BotFather](https://t.me/BotFather) (`/newbot`, il donne le jeton), puis lui écrire un message (ou
l'ajouter au groupe voulu). `sudo python3 setup.py` demande le jeton, retrouve la conversation par
`getUpdates` et propose un message de test. Le jeton est secret, comme l'URL d'un webhook.

`sudo python3 setup.py --check` vérifie les canaux **sans rien publier** : webhook Discord lu par un
`GET` (nom, salon), bot Telegram par `getMe` et conversation par `getChat` (« chat not found » : écrire
d'abord au bot).

Test : `python3 watcher.py --dry-run`.

</details>

<details>
<summary><b>6. Santé des machines</b> : <code>health_url</code></summary>

- `"health_url": "health/"` : `health.py` intégré, installé par `install.sh` (toutes les 6 h). Prérequis
  par machine : bloc 2 (groupe `adm`, sudoers `smartctl`). Sans eux, les cases concernées affichent
  « non lisible » ou « non accessible », le reste fonctionne.
- Autre URL : health-watcher externe au même format (`install.sh` n'installe alors pas `health.py`).
- Vide : onglet Health et colonnes Disque / Systemd / Maj masqués.
- Une machine est exclue avec `"health": false`, ou relevée par un autre alias avec `"health": "<alias>"`.

Test : `sudo python3 health.py --dry-run`.

**Machines Windows** : relevées par OpenSSH Server (intégré à Windows 10 / 11 / Server 2019+) et PowerShell,
en un appel, en lecture seule. Rien d'autre à installer.

| Colonne | Sous Windows |
|---|---|
| Disque | volumes locaux (`Win32_LogicalDisk`) |
| Systemd | services en démarrage automatique arrêtés avec un code d'erreur |
| Charge | % CPU instantané (alerte ≥ 90 %), nombre de CPU, jours depuis le dernier démarrage |
| Noyau | journal Système, 24 h : erreurs critiques (ex. arrêt brutal) et erreurs disque (Ntfs, disk, stor…) |
| Maj | mises à jour Windows Update en attente (titres), redémarrage en attente |
| SSH | échecs de connexion Windows (événement 4625) ; compte **administrateur** requis |
| SMART | `Get-PhysicalDisk` : état de chaque disque (Healthy, sinon alerte) |
| Docker | N/A |

1. Sur le PC : *Paramètres → Système → Fonctionnalités facultatives → Ajouter → Serveur OpenSSH*, puis en
   PowerShell administrateur : `Start-Service sshd; Set-Service sshd -StartupType Automatic` (le pare-feu
   est ouvert à l'installation).
2. La clé de la collectrice (`sudo cat /root/.ssh/myservices.pub`) : pour un compte **administrateur**,
   dans `C:\ProgramData\ssh\administrators_authorized_keys` (et non `~\.ssh`), avec ses droits restreints :
   ```powershell
   Add-Content C:\ProgramData\ssh\administrators_authorized_keys 'ssh-ed25519 AAAA… myservices'
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant Administrateurs:F /grant SYSTEM:F
   ```
   Sur un Windows en anglais : `Administrators` au lieu de `Administrateurs`. `ssh-copy-id` ne marche pas vers Windows.
3. Un alias dans `/root/.ssh/config` (`User` = le compte Windows), test : `sudo ssh <alias> whoami`.
4. `sudo python3 setup.py --add <alias>` : Windows reconnu par PowerShell, la machine garde `"ssh": null`
   (le collecteur ne lit que Linux) et reçoit `"os": "windows", "health": "<alias>"` ; accès vérifié aussitôt.
   Une machine marquée « souvent éteinte » (`"off": true`) n'est pas relevée par `health.py`.

Compte non administrateur : tout marche sauf les échecs de connexion (« non lisible »).

</details>

<details>
<summary><b>7. Sauvegardes</b> : <code>backups.py</code> (facultatif)</summary>

`backups.py` ne fait **aucune** sauvegarde : il vérifie celles que vos scripts produisent. Deux fois par
jour, il inspecte chaque machine par SSH (un agent Python envoyé par stdin, rien n'est installé là-bas) :
archives de chaque emplacement (date, taille), retard des copies sur la source, lignes de cron et timers
de sauvegarde, espace disque, dossiers de sauvegarde que rien ne surveille. Il écrit `web/backups.json`,
affiché dans l'onglet Backups.

L'inventaire se décrit à la main dans `backups-meta.json` (local, non versionné), à partir de
`backups-meta.example.json` dont le champ `_doc` détaille chaque clé :

- `hosts` : les machines (`ssh` = alias, `null` ou `"local"` = la collectrice ; `mount` = NAS monté sur la
  collectrice, seul son disque est lu ; `api: "ha"` = Home Assistant par son API REST) ;
- `sets` : un jeu = une origine + ses emplacements, **la source d'abord**, puis les copies. Pour chacun :
  `path`, `pattern` (motif des archives), `max_age_days` (seuil d'alerte), `mode: "each"` si chaque
  archive à nom fixe doit être récente ;
- `discover` : motifs des dossiers de sauvegarde à repérer sur les disques.

Niveau d'un jeu : **OK** si l'archive source est plus récente que le seuil **et** qu'au moins une copie
hors machine est à jour ; WARN / CRIT sinon.

```bash
cp backups-meta.example.json backups-meta.json && chmod 600 backups-meta.json   # puis l'adapter
sudo python3 backups.py          # écrit web/backups.json
sudo python3 setup.py            # propose "backups_url": "backups.json"
sudo ./install.sh                # installe myservices-backups.timer (07:05 et 19:05, --backups-at)
```

Permissions, sur chaque machine : lecture des dossiers de sauvegarde par le compte SSH. Pour lister la
crontab root depuis un compte non root (sinon « crontab root non lisible », le reste fonctionne) :

```bash
echo 'myservices ALL=(root) NOPASSWD: /usr/bin/crontab -l -u root' \
  | sudo tee /etc/sudoers.d/myservices-crontab-read && sudo chmod 440 /etc/sudoers.d/myservices-crontab-read
```

Home Assistant : jeton longue durée (*Profil → Sécurité → Jetons d'accès longue durée*) dans un fichier
`HA_URL=…` / `HA_TOKEN=…` en mode 600, chemin dans `secrets` de l'hôte.

**Veeam Backup & Replication** (Windows) : lu par son API REST, rien à installer sur Windows.

**Le plus simple : `sudo python3 setup.py`**, section « Sauvegardes ». Il cherche le serveur (port 9419 des
machines déclarées), demande le compte en lecture et l'écrit dans `/root/.veeam-secrets` (600), teste
l'API, liste les jobs, puis, pour chacun : le suivre ?, quelle machine il sauvegarde, après combien de jours
alerter. `backups-meta.json` est écrit, l'onglet activé ; relancé plus tard, il ne propose que les nouveaux
jobs. Ce qui suit est le détail, pour une écriture à la main.

- Port **9419** (service « Veeam Backup Server RESTful API »). Le 9392 est celui de la console et de
  PowerShell, inutilisable depuis Linux. Ouvrir le 9419 depuis la collectrice dans le pare-feu Windows.
- Compte en lecture seule : un utilisateur Windows avec le rôle **Veeam Backup Viewer**
  (*Menu → Users and Roles*). Identifiants dans un fichier en mode 600, jamais dans `backups-meta.json` :

```bash
printf 'VEEAM_USER=DOMAINE\\lecteur\nVEEAM_PASS=motdepasse\n' | sudo tee /root/.veeam-secrets >/dev/null
sudo chmod 600 /root/.veeam-secrets
```

```json
"hosts": [
  {"id": "veeam", "label": "Serveur Veeam", "ip": "192.168.1.50", "api": "veeam",
   "url": "https://192.168.1.50:9419", "secrets": "/root/.veeam-secrets"},
  {"id": "pc", "label": "PC Windows", "ip": "192.168.1.60", "api": "none"}
],
"sets": [
  {"id": "pc-veeam", "label": "PC Windows : image", "origin": "pc", "max_age_days": 2,
   "locations": [{"host": "veeam", "veeam_job": "Backup PC", "via": "job Veeam"}]}
]
```

`veeam_job` = nom exact du job dans la console. Niveau : âge du dernier passage, `Failed` = CRIT, `Warning` = WARN.
Le job compte comme copie hors machine (il écrit dans un dépôt Veeam) ; `"offsite": false` si ce dépôt est
sur la machine sauvegardée elle-même. Les dépôts apparaissent comme disques (espace libre), les jobs comme
lignes de planning. `api: "none"` : machine seulement origine de jeux, sans accès. Versions : v12 et
suivantes par défaut ; v11 : `"api_version": "1.0-rev2"` sur l'hôte.

Test sans attendre le timer : `curl -k https://<serveur>:9419/api/oauth2/token -H 'x-api-version: 1.1-rev0'
-d grant_type=password -d username='DOMAINE\lecteur' -d password=…` doit renvoyer un `access_token`.

Script de sauvegardes externe à la place : un lien `web/backups.json` → son fichier, au même format.
`install.sh` n'installe alors pas `backups.py`, qui refuse d'écrire dans un lien.

</details>

<details>
<summary><b>8. Intégrations de la page</b> : sshlist, liens, URL publique</summary>

| Clé | À fournir | Vide |
|---|---|---|
| `sshlist` | chemin d'un script sshlist (accès SSH et notes en plus de `~/.ssh/config`) | ignoré |
| `links` | `[{"label": "Portail", "url": "../"}]` | aucun lien |
| `public_url` | URL de la page | pas de lien dans les alertes |
| `collector_name` | nom affiché dans les alertes | hostname |

Côté serveur web : avec nginx, une seule étape manuelle, `include snippets/myservices.conf;` dans le bloc
`server` voulu ; avec Apache, rien (voir « Ce que fait `install.sh` »).

</details>

<details>
<summary><b>9. Pièges fréquents</b> : remplissage et permissions</summary>

| Symptôme | Cause | Correction |
|---|---|---|
| « SSH injoignable » alors que `ssh nas` marche | test fait avec **votre** compte : le collecteur tourne en root, avec `/root/.ssh/` | refaire clé, `ssh-copy-id` et alias en root (`sudo -i`) |
| `Host key verification failed` | 1re connexion en `BatchMode` : la clé d'hôte ne peut pas être acceptée | une fois : `sudo ssh <alias> true` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | machine réinstallée | `sudo ssh-keygen -R <ip>`, puis `sudo ssh <alias> true` |
| clé demandant une phrase de passe | `BatchMode` ne peut rien demander | clé dédiée créée avec `-N ''` |
| machine rattachée à aucun alias | `HostName` est un nom qui ne résout pas, ou une autre IP que celle de `services-meta.json` | mettre l'IP dans `HostName` |
| machine restée sans SSH malgré son alias | question « utiliser l'alias ? » refusée, ou `setup.py` pas relancé | `--check` le signale : relancer `setup.py`, ou `"ssh": "<alias>"` à la main |
| lien des alertes en 404 / refusé | `public_url` sans le port du serveur web (ex. Apache sur 8066) | `--check` teste l'URL et propose la bonne ; `setup.py` la propose d'après le port qui sert la page |
| « Docker inaccessible » juste après `usermod -aG docker` | groupe pris en compte seulement à la session suivante | se reconnecter (ou redémarrer `sshd` côté machine si les sessions sont multiplexées) |
| `sudo docker` dans une règle sudoers | les commandes appellent `docker`, jamais `sudo docker` | groupe `docker`, pas sudoers |
| SMART « non accessible » malgré la règle | chemin non absolu, disque NVMe écrit `nvme0n1` au lieu de `nvme0`, ou fichier refusé (droits ≠ 440, nom contenant un `.`) | règle donnée par `setup.py --check`, `chmod 440`, `visudo -cf` |
| AdGuard « config illisible » | image autre que `adguard/adguardhome` (fichier ailleurs que `/opt/adguardhome/conf/`) | image officielle, ou signaler le chemin |
| `config.json` refusé | JSON invalide (virgule finale, guillemets typographiques) | `python3 -m json.tool config.json` |
| clé inconnue « ignorée » | faute de frappe dans `config.json` | message affiché par le collecteur : corriger le nom |
| `npm-api.sh` échoue en service mais pas à la main | `npm-api.conf` lisible par votre compte seulement, ou jeton en cache dans un dossier non accessible à root | conf et dossier du script à root, mode 600 |
| bouton ⟳ ou page en 403 | IP du navigateur hors du réseau autorisé (nginx ou Apache), ou page illisible par `www-data` | `./install.sh --lan <CIDR>` ; clone dans `/opt` plutôt que `/home` |

`sudo python3 setup.py --check` repère la plupart de ces cas et affiche la commande à lancer.

</details>

<details>
<summary><b>10. Liste de contrôle</b></summary>

Version courte de « Installation pas à pas » :

1. Collectrice : clé `/root/.ssh/myservices`, un alias par machine Linux dans `/root/.ssh/config` (bloc 1).
2. Chaque machine Linux : compte (existant ou dédié) dans `docker` et `adm`, clé posée sur ce compte (bloc 2).
3. Si NPM : `npm-api.sh` + `npm-api.conf` testés avec `--info` (bloc 3).
4. Si Veeam : port 9419 ouvert, compte Veeam Backup Viewer (bloc 7).
5. `sudo python3 setup.py` : réglages, machines, AdGuard, recherche réseau, NPM, sauvegardes.
6. `sudo python3 setup.py --check` (donne la cause de chaque échec et la commande qui le règle), puis `sudo ./install.sh`.
7. nginx : `include snippets/myservices.conf;`, `nginx -t && systemctl reload nginx`. Apache : rien à faire.
8. Vérifier : `python3 watcher.py --dry-run`, `sudo python3 health.py --dry-run`, puis la page.

</details>

## Prérequis

### Machine collectrice (celle qui lance MyServices)

| Besoin | Pourquoi | Paquet Debian |
|---|---|---|
| Linux avec systemd (≥ 250 pour afficher le prochain passage) | timers, bouton ⟳ | — |
| Python ≥ 3.9, bibliothèque standard seule | tous les scripts | `python3` |
| root | `ss -tlnp` avec les noms de process, clés SSH du collecteur | — |
| client SSH + clés sans phrase de passe, un alias par machine dans `/root/.ssh/config` | inventaire distant | `openssh-client` |
| `ping`, `ss`, `ip` | état des machines, ports en écoute, réseau local | `iputils-ping`, `iproute2` |
| `docker` (si des conteneurs tournent sur la collectrice) | inventaire local | `docker.io` ou docker-ce |
| nginx ou Apache (ou tout serveur web statique, `--no-web`) | servir `web/` et l'API du bouton ⟳ | `nginx` ou `apache2` |
| accès DNS (UDP 53) vers chaque AdGuard déclaré | contrôle DNS | — |

### Nginx Proxy Manager (facultatif)


<details>
<summary>Compte, accès à l'admin, ou <code>npm-api.sh</code></summary>

- Un compte de l'interface d'admin NPM (e-mail + mot de passe) : seules des lectures (GET) sont faites.
- L'admin (port 81 du conteneur) joignable depuis la collectrice. Sinon `"ssh"` dans l'instance :
  l'API est appelée par `curl` sur la machine de NPM (`curl` requis là-bas).
- Ou bien [`npm-api.sh`](https://github.com/Erreur32/nginx-proxy-manager-Bash-API) déjà configuré (`"api"`).

</details>

### Chaque machine distante (alias SSH dans `services-meta.json`)


<details>
<summary>Accès SSH, groupes, fichiers lus (détail au bloc 2)</summary>

| Besoin | Pour | Sans |
|---|---|---|
| connexion SSH par clé depuis root de la collectrice | tout l'inventaire | machine affichée « SSH injoignable » |
| compte dans le groupe `docker` | conteneurs, AdGuard (`docker exec … cat AdGuardHome.yaml`), adguardhome-sync (`docker logs`) | « Docker inaccessible » |
| lecture de `/etc/apache2/sites-*` (`setfacl -m u:<compte>:r`) | vhosts Apache | « vhost non trouvé (config non lisible) » |
| groupe `adm` ou `systemd-journal` | `health.py` : échecs SSH, erreurs noyau | « non lisible » |
| `sudo` NOPASSWD sur `/usr/sbin/smartctl -H` | `health.py` : SMART | « non accessible » |
| `ss` (paquet `iproute2`) | ports des `process_hosts` | process non listés |

Tout est en lecture seule : aucune commande ne modifie les machines distantes.

</details>

## Ce que fait `install.sh`


<details>
<summary>Étapes, unités systemd, nginx ou Apache</summary>

À lancer en root, depuis le dossier du projet :

1. `setup.py` si la configuration manque, sinon `setup.py --check` (arrêt en cas d'échec, sauf `--force`).
2. Unités dans `/etc/systemd/system/` générées depuis `deploy/systemd/*.in` :
   | Unité | Rôle | Utilisateur |
   |---|---|---|
   | `myservices.service` + `.timer` | collecteur (défaut : xx:10 et xx:40) | root |
   | `myservices-watcher.service` + `.timer` | veille des changements (défaut : xx:15 et xx:45) | propriétaire du projet |
   | `myservices-refresh-api.service` + `myservices-refresh.path` | bouton ⟳ (API sur 127.0.0.1) | propriétaire, ou `nobody` |
3. Serveur web, choisi tout seul (nginx s'il est installé, sinon Apache), ou forcé par `--nginx`,
   `--apache`, `--no-web`. Page `/myservices/` et API réservées au réseau local (`--lan`).
   - **nginx** : `conf.d/myservices-zones.conf` (limites de débit du bouton ⟳) et `snippets/myservices.conf`.
     `nginx -t` avant le rechargement ; en cas de refus, les fichiers sont retirés. **Une étape à la main** :
     `include snippets/myservices.conf;` dans le bloc `server` voulu.
   - **Apache** (Debian) : `conf-available/myservices.conf`, modules `proxy`, `proxy_http`, `headers`, puis
     `a2enconf`. `apache2ctl configtest` avant le rechargement ; en cas de refus, l'extrait est retiré.
     Rien à faire à la main : la page répond sur `/myservices/` de tous les sites d'Apache, sur son port
     habituel (`grep Listen /etc/apache2/ports.conf`). Pas de limite de débit : l'API impose 5 min entre passages.
4. Premier passage du collecteur, puis du watcher (baseline, sans alerte).

Une installation existante qui pointe vers un autre dossier n'est jamais écrasée (sauf `--force`).
`--destdir DIR` génère les fichiers dans `DIR` sans rien activer, pour les relire ou en faire un paquet.

</details>

## Plusieurs NPM


<details>
<summary>Identifiants, cibles vues depuis l'hôte du NPM, contrôle DNS</summary>

Chaque instance de `npm` est lue à chaque passage. Si une lecture échoue, le passage s'arrête : la page garde
les données précédentes et le watcher signale des données périmées, au lieu d'annoncer tous les hosts comme disparus.
Les id de la 1re instance restent ceux de NPM (l'historique est conservé quand on en ajoute une), ceux des
suivantes deviennent `nom/123`. La page affiche alors l'instance dans la colonne Réf. et dans l'en-tête, et la
recherche trouve une instance par son nom. Ajouter une instance fait apparaître ses hosts une seule fois comme « nouveau ».

Cibles vues depuis l'hôte du NPM, jamais sondées depuis la collectrice :
- IP d'un réseau docker de cet hôte : conteneur rattaché par son nom ;
- adresse de l'hôte lui-même sur son pont docker (`172.x.0.1`, IP secondaire) : vhost Apache, process, ou
  conteneur en réseau `host` dont le nom correspond au domaine ;
- `127.0.0.1` : boucle locale du conteneur NPM.

Contrôle DNS : un host à garde LAN doit résoudre vers l'IP de SA propre instance (`ip`, sinon déduite de l'URL ou de l'alias SSH).

</details>

## Santé des machines (`health.py`)


<details>
<summary>Machines relevées, accès, alertes</summary>

Toutes les machines de `services-meta.json` qui ont un accès sont relevées, sauf `off` ou `"health": false`.
L'accès vient de `health` (alias dédié), sinon de `ssh`, sinon de l'alias de `process_hosts`. `"vm": true`
(posé par `setup.py` d'après `systemd-detect-virt`) désactive SMART. Une alerte Discord n'est envoyée que
si le résumé change. Le premier passage sert de référence : il n'écrit aucun événement.

Côté machines distantes, deux réglages facultatifs, sinon la case affiche « non lisible » ou « non accessible » :
- échecs SSH et erreurs noyau : le compte SSH doit lire le journal (`usermod -aG adm <compte>`) ;
- SMART : `<compte> ALL=(root) NOPASSWD: /usr/sbin/smartctl -H /dev/sda` dans `/etc/sudoers.d/`, un disque par commande (bloc 2).

</details>

## Lancement manuel

```bash
python3 myservices.py          # collecte -> web/data.json
python3 watcher.py --dry-run   # affiche les changements sans rien écrire
python3 watcher.py             # écrit web/events.json, alerte s'il y a des changements
python3 health.py --dry-run    # santé des machines, affichée sans rien écrire
sudo python3 backups.py        # sauvegardes -> web/backups.json (si backups-meta.json existe)
```

Une fois installé, par systemd (même compte et mêmes réglages que les passages automatiques) :

```bash
systemctl list-timers 'myservices*' --no-pager     # prochains et derniers passages
sudo systemctl start myservices.service            # collecteur seul (= bouton ⟳)
sudo systemctl start myservices.service myservices-watcher.service myservices-health.service  # tout, dans l'ordre
journalctl -u myservices.service -n 30 --no-pager  # dernier passage (idem -watcher, -health, -backups)
```

Le watcher n'écrit sur la sortie standard **que** le résumé des changements (rien s'il n'y en a pas).
Un cron avec `MAILTO`, ou tout planificateur qui transmet la sortie, sert donc d'alerte. Le premier
passage initialise la baseline et n'envoie aucune alerte.

## Feuille de route

Ce qui est prévu ou envisagé, du plus utile au moins utile.

| Sujet | Aujourd'hui | Prévu |
|---|---|---|
| **Santé des machines Windows** | **fait** (bloc 6) : disques, services, CPU, journal Système, Windows Update, échecs de connexion, `Get-PhysicalDisk` | à valider sur un vrai Windows (développé et testé hors Windows) ; collecteur : conteneurs Docker Desktop, ports en écoute |
| **Synology (DSM 7)** | ping | SSH documenté et testé : compte administrateur, droits de `~/.ssh`, accès Docker de Container Manager (groupe `docker` remis au démarrage) |
| **AdGuard Home hors Docker et sans SSH** (box, Home Assistant) | non lu | lecture par l'API REST d'AdGuard (réécritures, règles perso), avec un compte |
| **Veeam** | jobs Veeam Backup & Replication par l'API REST (testé avec la v12.0) | confirmer l'espace des dépôts ; Veeam Agent for Windows (sans serveur) par le journal d'événements |
| **ESXi** | ping | état des VM et des banques de données par l'API |
| **Infos réseau par [MynetworK](https://github.com/Erreur32/MynetworK)** | recherche des machines par ping dans `setup.py`, sans MAC ni fabricant | lire son inventaire (scanner LAN, Freebox, UniFi) : MAC, fabricant, nom, en ligne / hors ligne, ports ouverts, client Wi-Fi ou filaire et borne. Voir ci-dessous |
| **Uptime Kuma** | non lu | connecteur : état et temps de réponse de ses sondes, rattachés aux services de la page |
| **Autres serveurs web** | nginx et Apache configurés seuls, le reste à la main (`--no-web`) | modèles Caddy et Traefik |
| **Alertes** | Discord et **Telegram** (bloc 5), vérifiés par `--check` sans rien publier | Telegram à valider avec un vrai bot (testé sur faux serveur) |

<details>
<summary>Audit : brancher MyServices sur MynetworK (API ou MCP ?)</summary>

**Ce que MynetworK a déjà** (v0.10, Node/Express, SQLite) : scanner du LAN (IP, MAC, fabricant, nom, état,
latence, ports), Freebox (hôtes LAN, baux DHCP, Wi-Fi), UniFi (équipements, clients, WLAN), topologie.

**Deux portes d'entrée, aucune taillée pour un autre programme :**

| | API REST (`/api/network-scan/history`, `/api/lan/devices`, `/api/dhcp/…`, `/api/topology`) | MCP (`/api/mcp`, Streamable HTTP) |
|---|---|---|
| Authentification | JWT de session web (`/api/users/login` avec compte et mot de passe), qui expire | **jeton nommé, longue durée, niveau `read_only`**, réservé au LAN |
| Pour MyServices | stocker un compte et se reconnecter à chaque passage (comme NPM sans `npm-api.sh`) | dialogue JSON-RPC (`initialize`, puis `tools/call`), réponses en texte JSON pensées pour un LLM |
| Outils / routes utiles | tout, y compris l'historique et les statistiques | `scan_get_devices`, `scan_get_device_by_ip`, `freebox_get_lan_hosts`, `freebox_get_dhcp_leases`, `unifi_get_clients`, `unifi_get_devices` |

**Recommandation** : côté MynetworK, accepter ses jetons `read_only` (ceux du MCP, ou un type « API »
dédié) sur les routes REST **en lecture** (GET). MyServices les appelle alors comme NPM : un jeton dans
`config.json`, pas de mot de passe, pas de session. Sans toucher à MynetworK, MyServices peut déjà parler
MCP (une soixantaine de lignes en bibliothèque standard), mais en dépendant d'un format prévu pour un LLM.

**Ce que MyServices en ferait** : `setup.py` propose les machines de l'inventaire MynetworK (nom, fabricant)
au lieu de son ping ; l'onglet Machines affiche MAC, fabricant, Wi-Fi / filaire et borne ; une machine vue
« hors ligne » par MynetworK confirme une panne. Lecture seule : aucun outil d'écriture (`scan_trigger_scan`,
`unifi_block_client`…) n'est appelé.

</details>

Fait récemment : NPM facultatif et lu par `npm-api.sh`, Apache géré par `install.sh`, recherche des
machines du réseau, AdGuard natif, synchro adguardhome-sync détectée seule, sauvegardes et Veeam intégrés.

## Contribuer : garde-fou avant commit et push

Après un `git clone` : `bash scripts/install-hooks.sh`. Le `pre-commit` et le `pre-push` (`.githooks/`) refusent tout
ce qui est sensible (jetons, mots de passe, clés, `config.json`, `.env`, bases, captures non relues…) ; le même contrôle
tourne sur GitHub (`safety.yml`). Détail : `scripts/safety.py`. Vos propres noms de domaine et IP : `.safety-deny`
(local, jamais versionné).
