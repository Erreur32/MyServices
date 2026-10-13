# Notes de version : MyServices 0.11.2

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.2** (13 octobre 2026) : l'onglet Santé ne montre plus que ce qui demande un coup d'œil.

## Pour tout le monde

**Quoi de neuf ?**
- **Santé, seulement s'il y a un souci** : une phrase en haut résume l'état (« 2 machine(s) à regarder : nas (disque /data rempli à 91 %), … » ou « 12 machine(s), toutes en bonne santé »). Les machines sans souci sont cachées ; un clic sur « Afficher les N autres » les montre, et le choix est gardé. Une recherche ou un filtre montre toujours tout ce qu'il trouve.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.2` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Nouveau** : `front/src/lib/healthCalm.ts` (choix gardé dans `ms.health.calm`), `front/src/tabs/health.test.tsx`.
- **Modifié** : `front/src/tabs/Health.tsx` (résumé, machines saines masquées).
