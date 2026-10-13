# Notes de version : MyServices 0.11.8

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.8** (13 octobre 2026) : revue de sécurité (SonarCloud, CodeQL), accessibilité, en-tête de développement plus parlant.

## Pour tout le monde

**Quoi de neuf ?**
- **Revue de sécurité** : les alertes graves de SonarCloud et de CodeQL ont été revues une à une. Corrigé : le compte SSH d'une machine trouvée est vérifié strictement, la lecture des crontabs Proxmox contrôle le numéro de VM et l'alias, la connexion UrBackup marque son MD5 comme imposé par le protocole. Les fausses alertes (chemins venant de la config, option « certificat auto-signé » choisie par connecteur, http sur le réseau local) sont marquées avec leur raison.
- **Accessibilité** : les cartes des sauvegardes suivies s'ouvrent par un vrai bouton (utilisable au clavier), l'interrupteur et « Retirer » restent à côté sans plier la carte ; le fond des fenêtres se ferme d'un clic comme avant ; cases et boutons radio ont un nom lisible par les lecteurs d'écran.
- **Petites corrections** : boutons de formulaire typés, jours des alertes triés comme des nombres.
- **Pour le développement** : l'en-tête de l'image de dev montre la version en prod, la branche et le commit, et la version prévue.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.8` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **SonarCloud** : chaque analyse envoie la version du projet (le code nouveau est celui depuis la dernière version) ; les écrans React, l'agent Windows et l'ancienne page statique sont hors couverture, la logique (Python, `front/src/lib`) reste mesurée ; http vers les applis du réseau local déclaré une fois (règle S5332).
- **Nouveau** : `scripts/git-rev.sh` (état git pour l'image de dev), tests de la commande d'import de bout en bout et des petits contrôles (`tests/test_small_guards.py`).
- **Modifié** : `machines_admin.py`, `backups.py`, `connectors/homelab_backups.py`, `front/src/tabs/BackupsSettings.tsx`, `front/src/components/Overlay.tsx`, `front/src/components/Header.tsx`, `sonar-project.properties`, `.github/workflows/sonarcloud.yml`.
