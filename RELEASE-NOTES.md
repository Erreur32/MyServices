# Notes de version : MyServices 0.10.16

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.16** (12 octobre 2026) : VMware ESXi accepte enfin la clé SSH de MyServices.

## Pour tout le monde

**Corrigé**
- **VMware ESXi refusait la clé SSH**, même placée au bon endroit : ESXi 8 fait tourner son serveur SSH en mode FIPS, qui refuse les clés ed25519. MyServices a maintenant une **seconde clé, en ECDSA**, que ESXi accepte. Elle est créée toute seule au démarrage et proposée après la clé habituelle : rien ne change pour les autres machines.
- La commande « autoriser la clé » (pour root) met cette clé ECDSA dans `/etc/ssh/keys-root/authorized_keys` sur un ESXi, et la sauvegarde pour qu'elle survive à un redémarrage.

**Sur un ESXi déjà configuré** : après la mise à jour, copier la nouvelle commande (Réglages → Machines, guide SSH) et la lancer sur l'ESXi en root, puis « Vérifier ». La clé ECDSA est aussi affichée dans Réglages → Clé SSH.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.16` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Clé** : `/config/ssh/myservices_ecdsa` (ECDSA P-256, commentaire `myservices-esxi`), créée par `server.prepare_ssh()` ; `server.with_ecdsa()` ajoute `IdentityFile ~/.ssh/myservices_ecdsa` après chaque `IdentityFile ~/.ssh/myservices` de la config SSH (une fois, les autres alias ne bougent pas) ; `GET /system` renvoie `ssh.public_esxi`.
- **Tests** : 519 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
