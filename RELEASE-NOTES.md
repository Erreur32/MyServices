# Notes de version : MyServices 0.11.12

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.12** (13 octobre 2026) : une aide Nextcloud qui donne la bonne commande, des blocs de commande plus larges, et des corrections de sécurité.

## Pour tout le monde

**Quoi de neuf ?**
- **Connecteur Nextcloud, aide refaite** : de vraies commandes pour créer et enregistrer le jeton serverinfo, sans Docker, avec l'image Docker officielle, avec All-in-One et avec l'image linuxserver.io.
- **La bonne commande pour votre installation** : quand MyServices connaît votre Nextcloud (trouvé par la détection, ou d'après l'adresse saisie), sa commande exacte passe en premier, avec le nom du conteneur ou le dossier du site ; les autres variantes restent repliées dessous.
- **Blocs de commande** (clé SSH, aide des connecteurs…) : le bouton « copier » devient une icône dans le bloc, en haut à droite ; la commande prend toute la largeur.
- **Aide des connecteurs repliée par défaut** : un clic sur « Besoin d'aide pour obtenir ces accès ? » l'ouvre.
- **Sécurité** : les avatars SVG sont lus avec `defusedxml` ; l'enregistrement d'un connecteur dont le test échoue ne renvoie plus le texte de l'erreur (la page demande la raison à la route de test, l'affichage ne change pas).

**Toujours à faire de votre côté** : l'envoi d'e-mails (mot de passe oublié) se règle dans Réglages → Système → E-mail.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.12` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `front/src/lib/connectorSetup.ts` (commande d'accès d'après le service trouvé : conteneur et image, ou dossier du site), dépendance `defusedxml==0.7.1` (figée, avec empreintes).
- **Modifié** : `connectors/nextcloud.py` (guide en étapes avec blocs de commande), `front/src/components/form.tsx` (`Copyable`), `front/src/tabs/Connectors.tsx`, `avatars.py`, `api.py` (réponse d'enregistrement sans texte d'erreur), fonctions de connecteurs simplifiées (Arcane, Pulse, Netdata, Dozzle) ; tests ajoutés pour l'envoi d'e-mails et ses routes.
- **Sécurité** : alertes CodeQL 18 et 19 corrigées.
