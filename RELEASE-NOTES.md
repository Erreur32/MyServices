# Notes de version : MyServices 0.10.21

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.21** (12 octobre 2026) : LogviewR se relie enfin, les machines retirées ne reviennent plus.

## Pour tout le monde

**Corrigé**
- **LogviewR** : relier le connecteur avec son jeton échouait (« f2b_get_active_threats : réponse illisible »). LogviewR met un avertissement avant les données venues des attaquants ; MyServices le lit maintenant correctement. Les prisons, bannissements et menaces s'affichent dans l'onglet Fail2ban.
- **Mode automatique** : une machine retirée à la main dans Réglages → Machines revenait à la recherche réseau suivante. La retirer la range maintenant aussi dans les appareils ignorés (Réglages → Découverte) : elle ne revient plus, un clic l'y fait revenir.

**Changé**
- **Réglages → Machines** cache les machines non suivies (interrupteur « Machine suivie » coupé), comme l'onglet Machines ; le bouton « Non suivies (N) » les montre.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.21` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Corrigé** : `connectors/logviewr.py` `_tool()` lit le premier bloc texte qui est du JSON (réponse `untrustedJsonResult` de LogviewR) ; `DELETE /machines/settings/{ip}` appelle `system.set_netscan_ignored()`.
- **Tests** : 524 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
