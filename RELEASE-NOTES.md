# Notes de version : MyServices 0.10.19

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.19** (12 octobre 2026) : l'apparence passe dans le profil.

## Pour tout le monde

**Changé**
- **Apparence dans le profil** (menu du compte → Mon profil) : thème, logo de l'en-tête, langue et largeur de la page ne sont plus dans Réglages. Chaque compte, lecture seule comprise, peut maintenant choisir son apparence. L'ancien lien `#settings/look` ouvre le profil.
- **Profil plus large** : mot de passe et sessions à gauche, apparence à droite sur grand écran.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.19` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Front** : `components/Appearance.tsx` (sorti de `tabs/Settings.tsx`), affiché par `tabs/Profile.tsx`.
- **Tests** : 523 Python, 97 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
