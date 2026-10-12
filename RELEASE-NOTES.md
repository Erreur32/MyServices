# Notes de version : MyServices 0.10.18

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.18** (12 octobre 2026) : VMware ESXi vérifié sans fausse alerte Docker, messages SSH plus clairs.

## Pour tout le monde

**Corrigé**
- **VMware ESXi** : « Vérifier » (Réglages → Machines) affichait « docker inaccessible, groupe docker » alors que le SSH marchait : un ESXi n'a simplement pas Docker. Il est maintenant reconnu (« SSH ✓, VMware ESXi : pas de Docker, normal ») et ses VM sont lues dans l'onglet Virtualisation. Même chose pour toute machine sans Docker : plus d'alerte. Le conseil « groupe docker » ne vient plus que si Docker existe mais est refusé au compte.
- La carte de la machine dit « pas de Docker sur cette machine » en gris, au lieu d'une coche verte.
- **Messages SSH plus clairs** : serveur SSH arrêté (avec où l'activer sur ESXi), machine injoignable, trop de clés essayées, aucun algorithme commun, connexion coupée par la machine.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.18` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `setup.check_machine()` (quand `docker ps` échoue avec SSH OK : `vmware -v` et `command -v docker`), `setup.ssh_why()` (nouvelles causes) ; `StatusLine` (front) pour « pas de Docker ».
- **Tests** : 523 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
