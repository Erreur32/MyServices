# Notes de version : MyServices 0.10.22

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.22** (12 octobre 2026) : nouvel onglet Sécurité.

## Pour tout le monde

**Quoi de neuf ?**
- **Onglet Sécurité** (il remplace l'onglet Fail2ban), en lecture seule, sans score : des faits.
  - **Résumé** : bannissements sur 24 h, menaces actives, sites publics à renforcer, machines qui acceptent root ou les mots de passe en SSH, appareils avec un port sensible.
  - **Fail2ban** (LogviewR) : prisons, derniers bannissements, et le détail des **menaces actives** (une IP qui passe d'une prison à l'autre, ou une campagne venue d'un même réseau) avec leurs IP et leurs prisons.
  - **Sites exposés à Internet** : les hôtes NPM sans liste d'accès, avec ce qui leur manque (HTTPS non forcé, pas de HSTS, « Block exploits » coupé, certificat bientôt expiré, en-têtes faibles).
  - **Certificats** (déplacés ici depuis Historique → Disponibilité).
  - **Accès SSH des machines** : root et mot de passe autorisés ou non, connexions refusées sur 24 h.
  - **Ports sensibles** vus par MynetworK : Telnet, FTP, SMB, bureau à distance, VNC, bases de données, API Docker sans TLS.
- **Nouvelle alerte « Nouvelle menace »** (LogviewR) : une fois par menace, la première lecture sert de référence.

**Corrigé**
- Le réglage SSH par défaut « prohibit-password », sûr, était affiché comme risqué.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

**Ce qu'il faut savoir**
- Sur une installation existante, la nouvelle alerte n'est pas cochée toute seule : Réglages → Alertes.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.22` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Ajouté** : `tabs/Security.tsx` (remplace `Fail2ban.tsx`), `components/Certificates.tsx` ; `connectors/logviewr.cluster()` (champs sûrs des menaces) ; genre d'alerte `menace` (`watcher.threat_snaps` / `diff_threats`).
- **Corrigé** : `lib/ssh.risky()` ignore la mention « (défaut) ».
- **Tests** : 525 Python, 98 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
