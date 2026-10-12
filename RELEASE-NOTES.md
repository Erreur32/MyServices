# Notes de version : MyServices 0.10.14

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.14** (12 octobre 2026) : onglet Virtualisation (Proxmox, VMware ESXi et vCenter), sauvegardes vzdump, appareils du réseau à suivre, nouvelles icônes.

## Pour tout le monde

**Quoi de neuf ?**
- **Onglet Virtualisation** : chaque hyperviseur avec son processeur, sa mémoire et ses stockages, et le tableau de ses VM et conteneurs (état, ressources, depuis quand elles tournent, la machine suivie qu'elles sont, l'âge de leur sauvegarde, leurs conteneurs Docker). Il n'apparaît que si un hyperviseur ou Dockhand est trouvé.
- **Proxmox VE lu par SSH**, sans jeton : un Proxmox suivi par SSH apparaît tout seul.
- **VMware ESXi lu par SSH** : hôte, datastores et VM, avec l'IP de chaque VM donnée par les VMware Tools. Sur ESXi, SSH est coupé par défaut (Hôte → Actions → Services → Activer Secure Shell) et la clé de root va dans `/etc/ssh/keys-root/authorized_keys` : le guide SSH donne la commande.
- **VMware vCenter** : nouveau connecteur (Réglages → Connecteurs), avec un compte au rôle « Read-only ». Il lit tous les hôtes, VM et datastores d'un coup.
- **Sauvegardes vzdump** de Proxmox (sans Proxmox Backup Server) : Réglages → Sauvegardes → « Proxmox VE (vzdump) », un suivi par VM ; les copies faites par rsync vers un NAS se relient avec « Trouver les copies ».
- **Onglet Machines** : bouton « Suivre » sur les appareils vus par MynetworK et pas encore suivis ; le détail montre leurs ports ouverts, leur première et dernière apparition.
- **Nouvelles alertes** : nouvel appareil sur le réseau, VM ou conteneur arrêté, stockage presque plein (90 %).
- **Icônes** : VMware ESXi, vCenter, Free, Freebox, Western Digital, un vrai NAS, Plex redessiné.

**Corrigé**
- Réglages → Machines : une étiquette ajoutée ou retirée réapparaissait dans son ancien état après avoir fermé la carte ou changé d'onglet. Elle s'affiche maintenant tout de suite partout.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- VMware ESXi et vCenter n'ont été essayés que contre de fausses réponses construites d'après la documentation : vos retours sont précieux. Tout est en lecture seule.
- Les nouvelles alertes sont dans les règles d'exemple d'une nouvelle installation ; sur une installation existante, cochez-les dans vos règles (Réglages → Alertes).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.14` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `pve_ssh.py` (pvesh), `esxi_ssh.py` (vim-cmd, esxcli), connecteur `vcenter` (`connectors/vmware.py`), `connectors.proxmox.resources()` partagé ; `hostinfo` détecte `proxmox` et `esxi` ; routes `POST /backups/vzdump/discover` et `PUT /backups/vzdump` ; `machines_admin.publish()` (nom et étiquettes dans data.json à l'enregistrement).
- **Alertes** : genres `appareil`, `vm_arret` / `vm_marche`, `stockage` / `stockage_ok` (watcher.py, confirmés sur deux passages, première lecture = référence).
- **Rapprochement** : hyperviseurs `proxmox`, `esxi`, `vcenter` ; une VM VMware est reliée par son IP (VMware Tools).
- **Tests** : 514 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
