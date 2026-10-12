# Notes de version : MyServices 0.10.5

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.10.5** (12 octobre 2026) dit clairement ce que vous avez vraiment à faire, et lance seule la première recherche réseau.

## Pour tout le monde

**Quoi de neuf ?**
- **Page Découverte plus claire** (Réglages → Découverte) : en haut, une phrase résume tout. Puis, dans chaque famille, **« À faire »** ne garde que le nécessaire (clé SSH refusée, agent jamais installé, collecte en retard) ; **« Suggestions (facultatif) »** liste ce qui peut servir sans être obligatoire (applis à relier, machines trouvées, dossiers de sauvegarde à chercher), une ligne chacune ; ce qui tourne tout seul est replié en bas.
- **La cloche montre ce qu'il reste à faire** : un clic ouvre la liste, chaque chose avec son bouton, puis le nombre de suggestions. La pastille orange ne compte que le nécessaire ; la cloche devient grise s'il ne reste que des suggestions.
- **Première recherche réseau automatique** : elle part dans la minute après le démarrage, puis toutes les 6 h (0 la coupe toujours).
- **Corrigé** : « Lancer la recherche » dans la page Découverte ne faisait rien ; il lance maintenant la recherche et montre son cadre, allumé, avec l'avancement.

**Ce qu'il faut savoir**
- Proxmox (schéma), Prometheus, Healthchecks, Netdata, Jellyfin et Proxmox Backup restent essayés seulement contre de faux serveurs.
- Rien n'est modifié sur vos machines : MyServices ne fait que lire.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`).

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.10.5` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Changé** : `discoveries.py` ajoute l'état `suggest` (facultatif) à côté de `todo` (nécessaire) ; `GET /discoveries` rend aussi le nombre `suggest` ; `netscan.due()` est vrai sans recherche précédente (la première part seule).
- **Tests** : 478 Python, 92 front.
- **Détail complet** (en anglais) : [CHANGELOG.md](CHANGELOG.md).
