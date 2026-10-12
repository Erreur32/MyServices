# Notes de version : MyServices 0.10.15

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.15** (12 octobre 2026) : disponibilité dans l'Historique, commande SSH corrigée pour VMware ESXi.

## Pour tout le monde

**Quoi de neuf ?**
- **Historique → Disponibilité** (bouton « Événements | Disponibilité » en haut de l'onglet) : le taux de disponibilité de chaque service, machine et sonde Uptime Kuma, relevé à chaque collecte. Sur 24 h, 7, 30 ou 90 jours, avec une bande colorée par heure ou par jour, le temps de réponse moyen, les plus mauvais en premier et des filtres. Le relevé commence avec cette version : la vue se remplit au fil des heures.
- **Certificats** : sous la disponibilité, les certificats lus par Web-Check et Uptime Kuma, du plus proche de l'expiration au plus lointain.
- **Onglet Machines** : les badges des outils qui voient une machine ne sont plus dans la colonne Machine (il peut y en avoir beaucoup) ; ils restent dans le détail déplié.

**Corrigé**
- **VMware ESXi** : la commande « autoriser la clé » mettait la clé dans `~/.ssh/authorized_keys`, qu'ESXi ignore. Pour root, elle détecte maintenant un ESXi et met la clé dans `/etc/ssh/keys-root/authorized_keys`, puis la sauvegarde pour qu'elle survive à un redémarrage. Si vous l'aviez déjà mise au mauvais endroit, sur l'ESXi : `cat ~/.ssh/authorized_keys >> /etc/ssh/keys-root/authorized_keys` puis `/sbin/auto-backup.sh`.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Un relevé toutes les 30 minutes ne voit pas une coupure plus courte : Uptime Kuma, s'il est relié, garde le détail à la minute.
- La base garde le détail 14 jours et un résumé par jour pendant un an ; le reste est effacé tout seul.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.15` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `availability.py` (tables `avail_items`, `avail_samples`, `avail_days` dans `/data/myservices.db`), appelé par `server.keep_availability()` après chaque collecte réussie ; route `GET /api/v1/availability?days=N`.
- **Front** : `tabs/Availability.tsx`, sélecteur de vue dans `History.tsx` ; `lib/ssh.authorizeFor()` pour root reconnaît ESXi.
- **Tests** : 518 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
