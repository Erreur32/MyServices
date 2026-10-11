# Notes de version : MyServices 0.9.1

**0.9.1** (11 octobre 2026) est la première version numérotée de MyServices v2 (Docker), encore en BETA : les numéros restent sous la 2.0.0 tant que
ce n'est pas jugé stable. Elle reprend les préversions `2.0.0-alpha`, `beta` et `rc.1` à `rc.3`. Gardez une copie de vos dossiers `config/` et `data/` avant de mettre à jour.

> **Phase de test : ne pas mettre en production.** Essayez MyServices sur une machine ou un réseau de test.

## Pour tout le monde

**Quoi de neuf depuis la dernière préversion (rc.3) ?**
- **Nginx Proxy Manager se branche plus facilement.** Si vous utilisez NPM pour vos adresses web, MyServices peut maintenant le lire de
  trois façons. Choisissez celle qui convient à votre installation : en le contactant directement, en passant par une machine
  accessible en SSH, ou avec le petit script `npm-api.sh`. Chaque formulaire n'affiche que ce dont il a besoin et marque ce qui est
  obligatoire.
- **Le script `npm-api.sh` s'installe en un clic.** MyServices le télécharge, vérifie qu'il n'a pas été modifié en route, puis le met en
  place sur la bonne machine. Votre mot de passe NPM n'est jamais visible dans une commande.
- **Les messages sont plus clairs.** MyServices vérifie le chemin du script et vous donne des conseils en vert quand tout va bien.

**Aussi dans cette version** (ajouts après rc.3) :
- Dans Réglages → Connecteurs, l'onglet **Agents et SSH** passe en premier.
- Pour installer l'agent sur un PC Windows, la case « Adresse de MyServices » n'est plus affichée en permanence : elle apparaît
  seulement quand vous créez un nouvel agent, déjà remplie avec l'adresse de la page que vous regardez. Dans presque tous les cas,
  vous n'avez rien à taper.

**Ce qu'il faut savoir**
- Les trois façons de lire NPM n'ont pas encore été essayées avec un vrai NPM : si quelque chose ne marche pas, dites-le-nous.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : tirez la nouvelle image (`docker compose pull`, puis `docker compose up -d`). Vos réglages et vos données sont gardés.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.9.1` (amd64 et arm64), publiée à la poussée du tag ; `:latest` suit le dernier tag.
- **Connecteur NPM** : modes `api` (direct), `ssh` (API appelée depuis la machine) et `script` (`npm-api.sh`). Module `npmapi.py`.
- **`npm-api.sh` v3.6.9** : installé par MyServices avec vérification SHA-256 (`SCRIPT_SHA256`), `npm-api.conf` en 600, mot de passe
  transmis par stdin, exécution par SSH. À mettre à jour dans `npmapi.py` quand le dépôt du script publie un nouveau tag.
- **Front** : sous-onglets Agents et SSH / Connecteurs / Activation (ordre inversé) ; champ d'adresse de l'agent déplacé dans
  le cadre « Installer l'agent sur… » (valeur par défaut `location.origin`, plus de `localStorage`).
- **Tests** : 327 Python, 52 front. CI verte, 0 alerte Code scanning.
- **Détail complet** : voir [CHANGELOG.md](CHANGELOG.md).
