# Pages à construire avec les connecteurs

Résumé du plan en cours et propositions pour les nouvelles pages. **Rien de tout cela n'est écrit** : c'est une base de discussion.
Les routes des API sont décrites dans chaque connecteur (`connectors/*.py`) ; certaines restent à valider sur de vrais services.

## Où en est le projet

- Version publiée : 0.10.3 (`main`, tag `v0.10.3`).
- Stats historiques : agent, SSH, ping. Depuis la session 6, des connecteurs lisent aussi d'autres outils, en lecture seule.
- Connecteurs ajoutés : MynetworK, LogviewR, Dockhand, Proxmox VE et Proxmox Backup Server.
- Seul Dockhand a été lu sur une vraie instance. MynetworK est branché sur un vrai service ; LogviewR et Proxmox restent à essayer.

## Ce que les nouvelles sources apportent

Elles montrent ce que l'agent ne voit pas :

- **Le réseau sans agent** (MynetworK) : appareils inconnus, MAC, fabricant, ports ouverts, première et dernière apparition.
- **Ce qui tourne au-dessus des machines** (Proxmox, Dockhand) : VM, conteneurs, mises à jour d'images, stockage partagé, sauvegardes PBS.
- **Les avis des outils spécialisés** (LogviewR, Uptime Kuma, Web-check, Beszel) : bannissements fail2ban, disponibilité, certificats, SMART, services systemd en échec.

Le plus utile : recouper ces sources sur une même machine.

## Ce que chaque connecteur apporte

| Connecteur | Infos lues | Usage possible |
|---|---|---|
| MynetworK | ip, mac, hostname, fabricant, ping, ports, première / dernière apparition ; clients et bornes UniFi | page Réseau, appareils non suivis, nouveautés |
| Proxmox VE | nœuds (CPU, RAM, uptime), VM et LXC, stockages, tâches vzdump | page Virtualisation, sauvegardes en échec |
| Proxmox Backup | datastores (occupation), snapshots | sauvegardes par machine |
| Dockhand | environnements, conteneurs, mises à jour d'images en attente | page Conteneurs |
| LogviewR | prisons fail2ban, bannissements, menaces, sources de logs | page Sécurité |
| Beszel | machines, SMART, services systemd, stats système | santé des disques, services en échec |
| Uptime Kuma | statut, temps de réponse, jours restants du certificat | page Disponibilité |
| Web-check | certificat, HSTS, en-têtes, security.txt (sites publics) | exposition Internet |
| AdGuard Home | réécritures DNS, règles | chaîne DNS |
| Home Assistant | mises à jour disponibles, capteurs de sauvegarde | déjà partiellement utilisé |

Les connecteurs de `connectors/homelab_infra.py` (OPNsense, CrowdSec, Pi-hole, TrueNAS, Synology, UniFi, Tailscale, NUT, Portainer) ont des routes écrites de mémoire : à valider avant d'en faire des pages.

## Pages proposées

1. **Réseau** (nouvelle) : inventaire MynetworK fusionné avec Machines. Badges « suivi » / « vu seulement », nouveautés, ports ouverts, bornes et clients UniFi.
2. **Virtualisation** (nouvelle) : nœuds Proxmox avec jauges, VM et LXC avec leur hôte, stockages partagés, dernières sauvegardes vzdump, datastores PBS.
3. **Sécurité** (refaite, remplace Fail2ban) : bannissements et menaces LogviewR, certificats (Kuma, Web-check), en-têtes des sites publics, ports exposés. Un score d'exposition simple.
4. **Conteneurs** (nouvelle ou dans Docker) : environnements Dockhand, conteneurs par machine, mises à jour en attente, liens Dozzle.
5. **Disponibilité** (nouvelle) : statut Kuma et Prometheus dans le temps, temps de réponse, taux de disponibilité, calendrier des certificats qui expirent. Demande un historique (`history.py`, SQLite).
6. **Stockage et disques** : SMART Beszel, occupation des disques, stockages Proxmox et PBS ; à rapprocher de TrueNAS et Synology plus tard.
7. **Sauvegardes** (enrichie) : une table pour vzdump, PBS, Veeam et Home Assistant, avec l'âge de la dernière sauvegarde par machine.

## Rapprochement des machines

Une fiche par machine, avec un badge par source. Clés de rapprochement : IP, MAC, nom d'hôte.

- Une VM Proxmox présente dans MynetworK (MAC) et Dockhand (hôte) : même machine.
- Une machine dont l'IP est dans MynetworK mais sans agent : « vue par MynetworK, pas suivie ».

On affiche et on renvoie vers l'outil source plutôt que de le recréer.

## Alertes proposées

- Nouvel appareil sur le réseau (MynetworK).
- Pic de bannissements fail2ban (LogviewR).
- Nœud Proxmox, ou sauvegarde vzdump / PBS en échec.
- Mise à jour d'image en attente depuis plus de N jours (Dockhand).
- Disque SMART en alerte, ou service systemd en échec (Beszel).
- Certificat à moins de 21 jours (déjà en place pour Web-check).

## Ordre proposé

1. Valider MynetworK, LogviewR et Proxmox sur les vrais services (l'auteur crée les jetons).
2. Page Réseau.
3. Virtualisation et sauvegardes Proxmox / PBS.
4. Sécurité refaite.
5. Disponibilité avec historique.
6. Alertes sur les nouveaux cas.

## Limites

- Les routes de Dockhand et Beszel viennent d'intégrations tierces ou du code source, pas d'une doc officielle : lecture tolérante, à revérifier à chaque mise à jour.
- Limites d'appels : Uptime Kuma (60 requêtes par minute), Web-check (cache quotidien). À mesurer sur le Docker de prod avant d'ajouter des pages qui rafraîchissent souvent.
- L'historique (disponibilité, bannissements) fera grossir SQLite : prévoir une purge.

## Questions ouvertes

- Ordre des pages : d'accord ?
- Nouvel onglet ou section de Santé pour chacune ?
- La couche de rapprochement (IP, MAC, hôte) sert-elle de base à ces pages ?

## Avis de Claude (2026-10-11, à discuter)

Le fond est bon : recouper les sources sur une même machine est ce qui donne de la valeur aux connecteurs.
**Désaccord principal : trop d'onglets.** Il y en a déjà 9 ; le plan en ajoute 4 ou 5. Proposition : enrichir l'existant et ne créer
**qu'un seul onglet**.

| Proposé plus haut | Proposition |
|---|---|
| Réseau (nouveau) | **Dans l'onglet Machines** : filtre « suivie / vue seulement » (la section « Vus par MynetworK, pas suivis » existe déjà) |
| Virtualisation + Conteneurs | **Un seul nouvel onglet « Virtualisation »** : nœuds Proxmox, VM / LXC et conteneurs Dockhand, rangés par hôte |
| Sécurité (remplace Fail2ban) | D'accord, **sans score d'exposition** au début (difficile à justifier) |
| Disponibilité | **Dans l'onglet Historique** (axes et courbes déjà en place) |
| Stockage et disques | **Section de Santé** (SMART, occupation) |
| Sauvegardes enrichies | D'accord : peu coûteux, PBS et vzdump sont déjà lus |

Comme Fail2ban aujourd'hui, un onglet n'apparaît **que si son connecteur est relié** : sans Proxmox, pas d'onglet Virtualisation.

### Ordre proposé

1. **Couche de rapprochement d'abord** (IP, MAC, nom d'hôte ; une fiche par machine, un badge par source). Base de tout le reste ;
   testable avec de faux serveurs, sans attendre les jetons.
2. **Machines enrichies** par MynetworK.
3. **Sauvegardes** : PBS et vzdump dans la même table.
4. **Onglet Virtualisation.**
5. **Sécurité** refaite.
6. **Disponibilité** dans Historique, avec la purge de SQLite.

Les **alertes viennent avec chaque page**, pas toutes à la fin (« nouvel appareil » avec l'étape 2, « sauvegarde PBS en échec » avec l'étape 3…).

**Dépend de l'auteur** : créer les jetons MynetworK, LogviewR et Proxmox pour l'essai réel. L'étape 1 peut commencer sans eux.

### À trancher

- [ ] Un seul nouvel onglet (Virtualisation), le reste dans l'existant ?
- [ ] Commencer par la couche de rapprochement ?
- [ ] Score d'exposition : gardé ou laissé de côté ?
