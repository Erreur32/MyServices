# Notes de version : MyServices 0.10.6

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.6** (12 octobre 2026) : un seul conteneur, plus de conteneur « init » arrêté à côté.

## Pour tout le monde

**Quoi de neuf ?**
- **Plus de `myservices-init-1` en « Exited »** : l'image règle elle-même les droits de `./config` et `./data` au démarrage, puis l'app tourne toujours sous le compte 10001, jamais root, sans aucun droit noyau.
- **Compose d'exemple refait** (`deploy/compose.example.yaml`) : un seul service, commentaires plus courts, en anglais.

**Mettre à jour une installation existante** (une seule fois) :
1. Dans votre compose, supprimez le service `init` et le bloc `depends_on` du service `myservices`.
2. Ajoutez au service `myservices` : `user: "0:0"` et `cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]` (le plus simple : reprendre `deploy/compose.example.yaml`).
3. `docker compose pull && docker compose up -d --remove-orphans` (supprime l'ancien conteneur `init`).

Sans ces changements, votre compose actuel continue de marcher comme avant (avec son `init`).

**Ce qu'il faut savoir**
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.6` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `deploy/entrypoint.sh` (démarré en root : `chown` / `chmod` de `/config` et `/data`, puis `setpriv` vers 10001 sans capacité) ; `app_user.drop_root()` pour `setup.py` et `manage.py` lancés par `docker compose exec`. L'image reste en `USER myservices` par défaut.
- **Tests** : 478 Python, 92 front ; compose d'exemple rejoué dans un dossier vierge.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
