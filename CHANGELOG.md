# Changelog

Toutes les évolutions notables de MyServices v2 (Docker). Une section par version publiée, la plus récente en haut.
Les versions portent un suffixe `-alpha.N`, `-beta.N` puis `-rc.N` (candidate à la sortie) ; l'étiquette d'image `:latest`
suit le dernier tag publié, préversion comprise (la 2.0.0 finale la gardera seule). Images : `ghcr.io/erreur32/myservices`
(amd64 et arm64). Voir aussi [RELEASE-NOTES.md](RELEASE-NOTES.md) pour la dernière mise à jour expliquée simplement.

## v0.0.1 (2026-10-11) : première version stable

Reprend tout ce qui est dans les préversions ci-dessous (alpha, beta, rc.1 à rc.3) et ajoute :

### Modifié
- Réglages → Connecteurs : le sous-onglet **Agents et SSH** passe avant **Connecteurs**.
- Agents : le champ « Adresse de MyServices, vue du PC » n'est plus affiché en haut de la page. Il n'apparaît qu'à une nouvelle
  demande d'agent (cadre « Installer l'agent sur… »), prérempli avec l'adresse de la page ; plus de mémorisation par le navigateur.
  Il réapparaît dans le cadre « Agent créé » seulement si l'adresse saisie est invalide.

## v2.0.0-rc.3 (2026-10-11)

### Ajouté
- **Connecteur Nginx Proxy Manager en trois modes** : API directe, API par SSH, ou script `npm-api.sh`. Champs adaptés à chaque mode,
  champs requis marqués, vérification du chemin avec conseils.
- **Installation de `npm-api.sh` v3.6.9** depuis MyServices : empreinte SHA-256 vérifiée, `npm-api.conf` en 600, mot de passe passé par
  l'entrée standard (jamais en argument), script lancé par SSH sur la machine choisie.
- En-tête du formulaire avec l'icône du connecteur ; un seul formulaire ouvert à la fois.

## v2.0.0-rc.2 (2026-10-11)

### Modifié
- Image Docker : `:latest` suit le dernier tag poussé, préversion comprise (`-beta.N`, `-rc.N`). Image vérifiée en amd64 et arm64.
- README : mention BETA (badge, encadré sur ce qui est encore en test), règle des versions `-beta.N` puis `-rc.N`.

## v2.0.0-rc.1 (2026-10-11)

### Ajouté
- **Agent Windows** (PowerShell, lecture seule) en versions 2 à 4 : système (Windows, build, durée de marche), ports TCP en écoute avec
  leur processus, matériel (modèle, BIOS, processeur, mémoire, graphique, réseau IPv4, domaine, dernière mise à jour), repris dans
  l'onglet Machines et dans les services. Le premier relevé, ou une réinstallation dans une autre version, lance la collecte.
- **Agents** : un clic sur un PC Windows prépare l'agent et demande confirmation avant de créer le jeton ; la commande à copier suit le
  champ « Adresse de MyServices » (jeton gardé en mémoire de la page) ; le cadre « Agent créé » confirme la réception du premier relevé
  et le système détecté ; la page se rafraîchit toute seule (5 s en attente d'un relevé, sinon 10 s, à l'arrêt si l'onglet est caché).
- **Sauvegardes** : assistant Veeam (essai, recherche des jobs, suivi, mot de passe chiffré) et sauvegarde automatique de Home Assistant.
- **Réglage Machines** : bouton « Redétecter » (écarts proposés, cases à cocher, confirmation avant écriture), choix de l'icône de la
  machine (applications, systèmes, objets ; Auto par défaut), « Ne plus suivre » sur chaque ligne de l'onglet Machines.
- **API v1** : routes de lecture typées par le modèle commun (`GET machines`, `services`, `health`, `backups`), ouvertes aux jetons `read`.
- **Fusion des sources de santé** (SSH, agent, Beszel) selon une priorité réglable machine par machine ; modèle de données commun
  (`models.py`), cache des connecteurs (`ctx.cached`), alerte « version non testée ».
- **Relecture d'une seule machine** : cache d'inventaire par machine, `health.py --only <ip>`, route `POST machines/settings/<ip>/refresh`,
  appelée après un réglage, un test d'accès réussi ou l'ajout d'une machine.
- **Santé Home Assistant** : mises à jour séparées (cœur, modules, autres appareils).
- **Recherche réseau** : port 5000 lu par sa page (Frigate…), nom deviné sans DNS (NetBIOS, certificat HTTPS), applis reconnues par leurs
  ports (Proxmox VE 8006, Backup Server 8007, Ollama 11434, LM Studio 1234, Veeam 9419/9392/9401, llama.cpp, Home Assistant 8123/4357).
- Réglages → Connecteurs en **sous-onglets** (Connecteurs, Agents et SSH, Activation) ; Activation en tableau ; les machines Linux lues
  par SSH sont groupées avec leur état et un lien vers leurs réglages, à côté des agents Windows.
- Chaînes d'intégration : couverture des tests envoyée à SonarCloud (Python via `coverage`, front via `vitest`), Dependabot sans montée
  de version majeure (Node reste en 22 LTS).

### Modifié
- Machines : chemin complet de `authorized_keys` selon le compte choisi ; clé SSH refusée : la carte dit pour quel compte et donne la
  commande ; un test d'accès réussi lance la collecte ; « Réglages → Clé SSH » est un vrai lien ; l'état de la connexion est dans le cadre
  Accès, en premier ; menu « Options de la machine » replié avec les options actives montrées dehors.
- Connexion et fichiers : la destination de redirection est relue comme une adresse du site (sous `/myservices/` seulement).
- Recherche réseau : lecture du nom du certificat en TLS 1.2 minimum.

### Corrigé
- Santé : un relevé d'agent aux mises à jour mal formées ne fait plus planter la page (PowerShell 5.1 range un tableau relu en
  `{value, Count}`).
- Agents : plus d'erreur quand la machine d'un agent n'est pas encore dans la liste ; seuls les PC Windows ont un agent.
- Recherche réseau : plus d'étiquette « port 5000 » sans appli reconnue.
- Erreurs 422 de l'API : la valeur envoyée n'est plus renvoyée.

## v2.0.0-beta.1 (2026-10-10)

### Ajouté
- Première version « beta » (vraie release GitHub, image `2.0.0-beta.1` amd64 et arm64).
- Machines : « Machine virtuelle » se coche seule quand la détection la trouve (une fois par machine).

## v2.0.0-alpha.4 (2026-10-10)

### Ajouté
- Dependabot hebdomadaire (pip, npm, Docker, Actions, groupés), Code scanning activé.
- Machines : le texte d'accès SSH passe dans le cadre « Ajouter une machine ».

### Modifié
- SonarCloud : sources sans doublon, tests retirés des sources.

## v2.0.0-alpha.3 (2026-10-10)

### Ajouté
- **Agent MyServices (Windows, sans SSH)** : jeton `msv_agent_` lié à une machine, route de réception du relevé, fusion dans la santé ;
  `agent.ps1` et `install.ps1` servis par MyServices ; Réglages → Agents ; santé lancée au premier relevé.
- **Santé par SSH** : température du processeur (`k10temp`, `coretemp`, `cpu_thermal`, seuils 85 / 95 °C), badge « VM » sans capteur,
  usage CPU, mémoire et swap (lus dans `/proc`), barres dans la fiche, colonnes CPU et Mémoire dans Machines, alerte mémoire à 90 / 97 %.
- **Profil** pour tout compte : mot de passe, sessions ouvertes, fermeture des autres appareils, durée des sessions réglable (admin).
- **Journal d'audit** avec filtres par type et par compte, export CSV.
- **Recherche réseau** : réseaux au choix (plusieurs /24), mode discret (ni TTL ni MAC), appareils ignorés avec « Reprendre ».
- **Machines** : interrupteur « Machine suivie » (désactivée : ni ping, SSH, santé ni alerte), accès SSH par interrupteur Actif / Inactif,
  icône du système ou de l'application hébergée (Proxmox, Home Assistant…), guide d'accès SSH pour Windows (OpenSSH, clé, compte) et
  pour Linux (commande d'autorisation de la clé), badge « Non terminé », passerelle / NPM / VM cochés d'après la détection.
- **Sauvegardes** : recherche des dossiers de sauvegarde par SSH et suivi depuis la page.
- **Accueil** : groupe de compteurs « Machines » (SSH OK, à régler, éteintes, injoignables) et avertissements.
- **Tâches et horaires** : interrupteur « Santé des machines » avec explication quand une tâche est coupée.
- **Connecteurs** : « + Ajouter » en mini cartes, accès et activation en deux parties, carte « Lus par SSH ».

### Modifié
- Réglages réorganisés en quatre groupes (Surveillance, Accès et sécurité…), « Recherche réseau » devient « Découverte », « Système »
  devient « Sauvegarde et infos », la section Sources disparaît (l'interrupteur d'affichage est dans la carte du connecteur).
- Docker absent n'est plus une panne (« pas de Docker sur cette machine ») ; le port 139 seul ne dit plus « Windows ».
- Capture de démonstration retirée du dépôt.

### Corrigé
- Un bandeau de connexion (fastfetch dans `~/.bashrc`) ne fausse plus la lecture d'une machine Linux en SSH.
- Favicon : chemin sous `/myservices/v2/` (l'ancien chemin était doublé).

## v2.0.0-alpha.2 (2026-10-10)

### Ajouté
- **Premiers pas** : assistant de premier démarrage avec recherche réseau, choix des machines, SSH proposé, Home Assistant par son API
  REST (jeton annoncé dès la liste), bouton « Passer » sur chaque étape, scan automatique, « Connecteurs proposés », icônes des
  applications reconnues, machine hôte détectée avec ses services Docker.
- Table « appli connue » : reconnaît les services et propose les connecteurs.
- Scan réseau : système probable (Windows, Linux, macOS, iPhone, matériel réseau) d'après bannière SSH, ports, TTL et MAC.
- UniFi : lu plus tard par l'API MynetworK, SSH facultatif.

### Modifié
- Home Assistant : une erreur 5xx indique le chemin en cause et renvoie vers les journaux.

## v2.0.0-alpha.1 (2026-10-10)

### Ajouté
- **MyServices v2** : version Docker (un seul conteneur : collecte, veille, santé, sauvegardes), connecteurs, nouveau front
  (`/myservices/v2/`), carte « Premiers pas », barre de scan. L'ancienne page v1 est retirée de cette branche.
- CI : une préversion (`-alpha`, `-beta`, `-rc`) ne publiait jamais `latest` (règle changée en rc.2).

### Corrigé
- Alertes Dependabot du front (vitest 4, postcss-selector-parser 7).
