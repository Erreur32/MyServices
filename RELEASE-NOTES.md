# Notes de version : MyServices 0.10.20

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.20** (12 octobre 2026) : Dockhand ne s'affiche plus dans l'onglet Virtualisation.

## Pour tout le monde

**Corrigé**
- **Onglet Virtualisation** : Dockhand y apparaissait sous « Sauvegardes Proxmox et conteneurs », même sans aucun Proxmox (avec un vCenter par exemple). Dockhand ne gère que Docker : ses cartes restent dans Santé (« Services et infrastructure »). L'onglet n'apparaît plus qu'avec un hyperviseur (Proxmox, ESXi, vCenter) ou un Proxmox Backup Server. Les conteneurs Docker d'une VM restent affichés sur sa ligne.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.20` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Front** : `lib/tabs.ts` (visibilité de l'onglet sur `virtualization` seulement), `tabs/Virtualization.tsx` (section du bas : Proxmox Backup Server seul).
- **Tests** : 523 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
