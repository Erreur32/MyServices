# Notes de version : MyServices 0.13.0

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.13.0** (18 octobre 2026) : l'état des machines est vivant, Proxmox donne plus d'informations, et la fenêtre d'une machine montre où elle est branchée.

## Pour tout le monde

**Quoi de neuf ?**
- **Vérifications en direct** : MyServices envoie un petit ping à chaque machine toutes les 30 secondes. Une machine qui tombe ou qui revient est annoncée en une ou deux minutes (avant, il fallait attendre jusqu'à une heure), dans la page, l'historique et les alertes. Un paquet perdu ne déclenche rien : il faut deux réponses de suite. Les réglages sont dans Réglages → Tâches et horaires.
- **Lectures rapides des outils** : MynetworK, Proxmox (par jeton) et Beszel sont relus toutes les 5 minutes, sans toucher à vos machines. Le rouge ou vert de la pastille Beszel suit son état réel, et les ports ouverts viennent de MynetworK avec la date de leur dernier scan.
- **Proxmox** : sous chaque nœud, la charge, le swap, le disque système, le noyau, le processeur et ce que prennent les machines virtuelles ; la température et les ventilateurs quand `lm-sensors` est installé sur l'hôte. La page Virtualisation grise les machines arrêtées et peut les masquer.
- **Fenêtre d'une machine** : avec MynetworK 0.10.74 ou plus, elle montre sur quel switch et quel port la machine est branchée (ou sa borne Wi-Fi), son nom dans UniFi, son bail et ses redirections de ports Freebox. Notre agent apparaît comme une source de plus.
- **Tableaux** : lignes zébrées et plus basses sur Services, Machines et Sauvegardes ; colonnes « Domaine » et « Service » mieux nommées ; filtres sur une seule ligne avec un bouton quand il y en a trop ; cadre des dossiers de sauvegarde repliable ; icônes de service plus grandes.
- **Sauvegardes** : suivi des tâches Hyper Backup de Synology (lecture seule).
- **Corrections** : les ports de MynetworK n'étaient plus lus ; une machine « souvent éteinte » vue en marche par Beszel est de nouveau lue, et une ancienne ligne « injoignable » ne reste plus affichée.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.13.0` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `pulse.py` (ping toutes les 30 s, `pulse.json`), `fast.py` (lectures légères, `live.json`), `connectors/mynetwork.py` (`scan`, `ip_details`, `compact_sheet`), `connectors/proxmox.py` (`node_extra`).
- **Modifié** : `watcher.py` (prend le pouls, ne compte jamais deux fois la même collecte), `health.py` (relance d'une seule machine, machine « souvent éteinte » lue par Beszel), `server.py` (boucles du pouls et des lectures rapides), `front/src/tabs/` (Machines, Services, Sauvegardes, Virtualisation, Historique).
- **Réglages** : `pulse_every` (30 s), `pulse_confirm` (2), `fast_every` (300 s) dans `config.json`, ou la ligne « Vérifications en direct » de Réglages → Tâches et horaires.
