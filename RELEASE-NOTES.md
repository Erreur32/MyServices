# Notes de version : MyServices 0.9.5

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test, et gardez une copie de `config/` et `data/` avant de mettre à jour.

**0.9.5** (11 octobre 2026) ajoute douze connecteurs pour les services de homelab, branche AdGuard Home tout seul, apprend à l'agent Windows à lire Docker et les services du PC, et corrige les fausses alertes de sauvegardes.

## Pour tout le monde

**Quoi de neuf ?**
- **Douze connecteurs de plus** : Frigate (caméras), Sonarr / Radarr / Lidarr / Prowlarr, OPNsense, CrowdSec, Pi-hole, Technitium, TrueNAS, Synology, UniFi, Tailscale / Headscale, un onduleur (NUT) et Portainer. Ils s'affichent dans Santé, « Service via API ».
- **AdGuard Home branché tout seul** quand MyServices le voit dans les conteneurs d'une machine lue par SSH : l'onglet DNS apparaît sans rien faire.
- **Des notifications « à faire »** : quand MyServices reconnaît une appli qu'il ne peut lire qu'avec votre accès (AdGuard sur un PC Windows, Frigate…), une notification vous le dit et un bouton ouvre le connecteur déjà rempli. Une cloche dans l'en-tête compte ce qui reste à faire (aussi : clé SSH à autoriser, machines trouvées pas encore suivies, agent à installer).
- **Agent Windows version 6** : il remonte aussi le Docker du PC et ses services Windows (Plex, AdGuard, Jellyfin…). **Réinstallez-le** pour en profiter.
- **Mise à jour des agents depuis la page** : chaque agent affiche sa version, avec un interrupteur « Automatique » et un bouton « Mettre à jour maintenant » (l'agent contrôle l'empreinte du script avant de se remplacer).
- **Sauvegardes sans fausses alertes** : un dossier suivi depuis la page n'exige plus de copie ailleurs, et l'âge d'alerte (2, 8, 15 ou 31 jours) est choisi d'après la sauvegarde observée, réglable par jeu.
- **Port SSH faux reconnu** : si la clé semble refusée alors que le port est mauvais, la fiche de la machine le dit et propose « Utiliser le port … ».
- **Corrections** : page Réglages → Machines blanche, carte qui restait grisée après « Machine suivie », avertissements qui revenaient après une correction, test « machine inconnue » de la clé SSH.

**Ce qu'il faut savoir**
- Les douze connecteurs ont été écrits d'après la documentation de chaque service et **essayés seulement contre de faux serveurs** : dites-nous ce qui ne marche pas avec les vrais.
- Les agents Windows en version 5 ou plus ancienne **ne savent pas se mettre à jour seuls** : une réinstallation (« Nouvelle commande » dans la carte de l'agent) est nécessaire une fois ; ensuite les mises à jour se font depuis la page.
- Il n'y a pas d'agent Linux ni macOS : SSH reste la voie pour Linux. C'est dans la feuille de route.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d`. Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.5` (amd64 et arm64) ; `:latest` suit le dernier tag.
- **Connecteurs** (`connectors/homelab_infra.py`, `homelab_media.py`, `status_kit.py`) : type `status`, lecture seule ; secrets en en-tête ou en corps POST, jamais dans l'adresse ; 23 tests contre de faux serveurs.
- **Nouveaux modules** : `autodetect.py` (AdGuard), `discoveries.py` (notifications à faire, `GET /discoveries`), `known_apps.py` (services Windows, empreinte HTTP).
- **Agent** : version 6 ; relevé `dk` (docker.exe) et `sv` (services) ; `PATCH /agents/{id}` (automatique), `POST /agents/{id}/update`, réponse du relevé avec `update` (version, chemin, SHA-256).
- **Sauvegardes** : `expect_offsite` par jeu, `PATCH /backups/settings/{id}`, seuil d'âge déduit.
- **Tests** : 425 Python, 83 front (dont un contre les hooks React après un `return`).
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
