# Notes de version : MyServices 0.11.11

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.11** (13 octobre 2026) : mot de passe oublié par e-mail, avatar, et des connecteurs qui lisent beaucoup plus.

## Pour tout le monde

**Quoi de neuf ?**
- **Mot de passe oublié ?** : un lien sur la page de connexion envoie un e-mail avec un lien à usage unique, valable 30 minutes, pour choisir un nouveau mot de passe. Il faut régler l'envoi dans **Réglages → Système → E-mail** (serveur SMTP, avec un bouton d'e-mail de test) et mettre son adresse dans **Profil**.
- **Avatar** dans Profil : PNG, JPEG, WebP, GIF (animé compris) ou SVG, affiché dans l'en-tête et le menu du compte.
- **Menu du compte** refait : plus simple, sans les liens vers les schémas (ils restent dans l'onglet Schémas).
- **Connecteurs testés avant de collecter** : à l'enregistrement et à l'allumage, un test passe d'abord ; s'il échoue, la collecte reste coupée et la raison s'affiche. Nouveau bouton « Enregistrer sans collecte » pour régler à l'avance un service arrêté.
- **Plus de sources** :
  - Conteneurs : **Dozzle**, **Arcane** et **Portainer** remplissent la carte Conteneurs, comme Dockhand.
  - Santé des machines : **Glances** et **Netdata** ; **Beszel** donne en plus les conteneurs, toutes les sondes de température et le swap.
  - Virtualisation : **Pulse** (nœuds Proxmox, VM, LXC).
  - **GpuViewR** : cartes graphiques, modèles IA en cours et statistiques sur 24 h dans la fiche de chaque machine.
- **Case « Vérifier le certificat HTTPS »** sur Beszel, AdGuard Home, Uptime Kuma, Web-Check et Dozzle.
- **Plus réactif** : un service détecté disparaît des listes dès que son connecteur est enregistré.

**Jamais essayés en vrai** : Netdata, Pulse et Portainer (vérifiés seulement contre de faux serveurs).

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.11` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `mailer.py` (smtplib, certificat toujours vérifié), `avatars.py` (format lu dans le contenu, SVG nettoyé et servi en `sandbox`), routes `password/forgot`, `password/reset`, `me/email`, `me/avatar`, `users/<nom>/avatar`, `system/mail` ; colonnes `email`, `avatar` et table `resets` ajoutées toutes seules à la base des comptes ; `smtp_password` chiffré au repos.
- **Modifié** : `connectors/` (Dozzle, Arcane, Portainer en sources de conteneurs ; Glances, Netdata en sources de santé ; Pulse en virtualisation ; Beszel et GpuViewR plus complets), `connectors/base.py` (`recent` : un relevé de moins de 10 min est réutilisé), `api.py` (test avant collecte), `matching.py`, `health.py`, `web/login.*`, `front/src/components/Dropdown.tsx`.
- **Sécurité** : alertes CodeQL 17 et 18 corrigées (nom d'exception renvoyé à la page, section de Réglages prise dans l'adresse) ; 16 écartée (MD5 imposé par le protocole d'UrBackup).
