# Notes de version : MyServices 0.10.17

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.17** (12 octobre 2026) : nouveau connecteur Nextcloud.

## Pour tout le monde

**Quoi de neuf ?**
- **Connecteur Nextcloud** (Réglages → Connecteurs) : une carte dans Santé avec la version (et la nouvelle si une mise à jour existe), les utilisateurs actifs sur 24 h, les fichiers, l'espace libre, la base de données, PHP, les applis et leurs mises à jour, les liens publics. Sont signalés : une mise à jour de Nextcloud ou d'une appli, des liens publics sans mot de passe, moins de 10 Go libres, le mode debug actif.
- **Accès par un jeton dédié**, aucun compte : sur le serveur Nextcloud, `openssl rand -hex 32` pour créer un jeton, puis `docker exec -u www-data <conteneur> php occ config:app:set serverinfo token --value <jeton>`. Le jeton n'ouvre que la page de supervision ; MyServices ne fait que lire.
- Un conteneur Nextcloud trouvé sur une machine propose maintenant de relier le connecteur.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Le connecteur n'a été essayé que contre une fausse réponse construite d'après la documentation de Nextcloud : vos retours sont précieux.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.17` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `connectors/nextcloud.py` (genre `status`, route `GET /ocs/v2.php/apps/serverinfo/api/v1/info?format=json`, en-têtes `NC-Token` et `OCS-APIRequest`) ; `known_apps` relie l'appli Nextcloud au connecteur.
- **Tests** : 523 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
