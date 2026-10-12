# Notes de version : MyServices 0.10.25

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.25** (12 octobre 2026) : UniFi relié en direct, Freebox par MynetworK.

## Pour tout le monde

**Quoi de neuf ?**
- **UniFi Network en direct**, sans passer par MynetworK. Deux façons de le relier (Réglages → Connecteurs → UniFi Network) :
  - **console UniFi OS** (UCG, UDM, UX, Cloud Key) : une clé d'API, créée dans Paramètres → Control Plane → Intégrations ;
  - **contrôleur UniFi en Docker** : il n'a pas de clé d'API, donc un **compte local en lecture seule** (rôle « View Only », sans double authentification), adresse `https://<IP>:8443`, accès « account ».
  
  On y voit les appareils en ligne ou non, ceux qui ont une mise à jour, et le nombre de clients. Les clients et appareils UniFi aident aussi à reconnaître vos machines (IP, MAC).
- **Carte « Freebox (via MynetworK) »** dans Santé : les appareils actifs vus par la Freebox. La ligne, les débits, la température et la durée depuis le dernier redémarrage s'afficheront quand MynetworK proposera cette lecture (à venir de son côté).

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.25` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Modifié** : `connectors/homelab_infra.py` (UniFi : clé d'API ou compte local), `connectors/mynetwork.py` (Freebox), `matching.py`, `myservices.py`.
- **Essais** : contre de faux serveurs seulement ; console UniFi OS, contrôleur Docker et Freebox complète restent à essayer en vrai.
- **Tests** : 534 Python, 98 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
