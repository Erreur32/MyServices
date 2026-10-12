# Notes de version : MyServices 0.10.7

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.7** (12 octobre 2026) : les journaux du conteneur dans la page, la recherche réseau qui marche partout, et un œil sur les mots de passe.

## Pour tout le monde

**Quoi de neuf ?**
- **Réglages → Journaux** : ce que montre `docker compose logs myservices`, directement dans la page (le serveur et chaque tâche, depuis le démarrage, 3000 lignes au plus). Filtres par origine (serveur, collecte, veille, santé, sauvegardes), erreurs seulement, recherche, suivi toutes les 5 s, téléchargement en `.txt`.
- **Un œil sur les mots de passe et jetons** des connecteurs (aussi depuis une machine), du script NPM et de Veeam : il montre ce que vous tapez. Pour une valeur déjà enregistrée, il redemande votre mot de passe, puis l'affiche ; c'est noté dans le Journal d'audit.
- **Corrigé : la recherche réseau trouvait 0 appareil sur certains hôtes** (NAS, certaines distributions où le ping sans droits est fermé). L'app garde maintenant le seul droit `NET_RAW`, juste pour le ping. Sans ce droit, la recherche dit pourquoi au lieu d'afficher 0 appareil.

**Mettre à jour** : ajoutez `NET_RAW` à la ligne `cap_add` de votre compose :
```yaml
cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, NET_RAW]
```
puis `docker compose pull && docker compose up -d`.

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.7` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `applog.py` (copie en mémoire de stdout / stderr), `GET /system/logs?after=N` ; `POST /connectors/settings/{type}/{name}/reveal` (session admin + mot de passe, limite d'échecs, audit) ; `entrypoint.sh` garde `NET_RAW` en capacité ambiante pour le compte 10001 quand le compose la donne ; `netscan` signale un ping refusé (`PingDenied`).
- **Tests** : 483 Python, 94 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
