# Notes de version : MyServices 0.11.10

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.10** (13 octobre 2026) : UniFi et Freebox plus complets grâce à MynetworK 0.10.68, la Freebox comme machine.

## Pour tout le monde

**Quoi de neuf ?**
- **Passerelle UniFi** (avec MynetworK 0.10.68 ou plus) : versions de UniFi OS et de l'application UniFi Network, leurs mises à jour, la température et la mémoire de la passerelle ; elle est reliée à sa machine par son adresse LAN.
- **Freebox comme machine** : ajoutez-la dans Réglages → Machines, sans SSH, avec « Freebox » dans son nom ; elle affiche alors « via MynetworK », sa santé (ligne, températures), son modèle, son firmware et la mise à jour proposée.
- **Carte Freebox** (onglet Réseau) : « 1 (+126 dans l'historique) » au lieu de « 1/127 » derrière un autre routeur, la vitesse du ventilateur, et la mise à jour du firmware quand Free en propose une.
- **Corrigé** : quand UniFi n'est pas branché dans MynetworK (réponse 503), le reste de MynetworK (scanner, Freebox) n'est plus perdu.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.10` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : lecture de `GET /api/plugins/unifi/system` (MynetworK 0.10.68+, champs nommés seulement), `latest_firmware` et `update_available` de la Freebox, `front/src/lib/freebox.ts`.
- **Modifié** : `connectors/mynetwork.py` (503 = pas d'UniFi), `front/src/lib/unifi.ts`, `front/src/tabs/Machines.tsx`, `front/src/tabs/Settings.tsx`, `front/src/tabs/UpdatesSettings.tsx` ; tests ajoutés (vérification des mises à jour, route des réglages, état « via un outil »).
