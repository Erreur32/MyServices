<p align="center"><a href="README.md">English</a> · <b>Français</b></p>

<p align="center">
  <img src="docs/logo.svg" alt="MyServices" width="360">
</p>

<p align="center">
  <b>L'état de vos services et de vos machines, au même endroit, en lecture seule.</b>
</p>

<p align="center">
  <a href="https://github.com/Erreur32/MyServices/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Erreur32/MyServices?label=version&color=3da9fc"></a>
  <img alt="Phase de test" src="https://img.shields.io/badge/statut-BETA%20%C2%B7%20phase%20de%20test-orange">
  <img alt="Pas en production" src="https://img.shields.io/badge/production-NON-ef4444">
  <a href="https://github.com/Erreur32/MyServices/pkgs/container/myservices"><img alt="Image Docker" src="https://img.shields.io/badge/image-ghcr.io%2Ferreur32%2Fmyservices-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555">
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml"><img alt="Tests et image Docker" src="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml/badge.svg"></a>
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml"><img alt="Garde-fou" src="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml/badge.svg"></a>
  <img alt="Lecture seule" src="https://img.shields.io/badge/acc%C3%A8s-lecture%20seule-22c55e">
</p>

> ## ⚠️ Toujours en phase de test : ne pas mettre en production
>
> MyServices v2 (Docker) est une **BETA**. Les écrans, les réglages et les données peuvent encore changer d'une version à l'autre, et
> plusieurs parties n'ont été essayées que sur un seul PC ou sur de faux serveurs (agent Windows, Veeam, sauvegardes Home Assistant,
> connecteur NPM). **Ne l'installez pas sur un serveur de production** : essayez-le sur une machine de test ou un réseau que vous
> pouvez casser, et gardez une copie de `config/` et `data/` avant chaque mise à jour.
> Il ne fait que lire vos machines, mais ce n'est pas une raison pour s'y fier tant qu'il n'est pas déclaré stable.
>
> Les numéros de version restent **sous la 2.0.0** tant que c'est le cas (`0.9.5`, `0.9.6`…) ; la 2.0.0 sera la première version
> annoncée stable. Détail : [CHANGELOG.md](CHANGELOG.md) (en anglais) · [RELEASE-NOTES.md](RELEASE-NOTES.md).

## En bref

MyServices centralise les services de toutes vos machines et de votre réseau local, et en donne l'état en direct. Il **s'appuie sur les
outils que vous avez déjà** (Nginx Proxy Manager, AdGuard Home, Beszel, Uptime Kuma, Home Assistant, Veeam…) sans les remplacer : il lit
leur API ou la machine par SSH, rapproche les informations et les présente sur une page.

- **Lecture seule** : rien n'est écrit sur ce qu'il observe.
- **Un seul conteneur** : collecte, veille, santé, sauvegardes, comptes, API et page web.
- **Onglets** : Accueil, Historique, Machines, Services, Santé, Fail2ban, DNS, Sauvegardes, Schémas, Réglages.
- **Machines lues** par SSH (Linux), par un agent PowerShell (Windows), par API ou par ping ; un PC souvent éteint garde une fiche grisée au lieu de disparaître.
- **Historique** en points à l'heure exacte, barres, courbe ou carte de chaleur ; chaque entrée dit ce qui l'a détectée et ce qui l'a lue.
- **Schémas** générés avec [Archify](https://github.com/tt-a1i/archify) : carte du réseau, qui lit quoi, accès aux machines, chaîne d'alertes, sauvegardes.
- **Alertes et notifications** Discord, Telegram et webhook : règles d'alerte, plus vos propres rapports (machines et capteurs au choix, à heure fixe) et événements en direct filtrés, avec des exemples prêts à l'emploi.
- **Découvertes** : l'application dit ce qui se fait tout seul et ce qui demande un clic ; `/home/backup` est suivi automatiquement.
- **API REST** et **serveur MCP** pour vos outils et assistants IA.

## Essayer (sur une machine de test)

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/docker/deploy/compose.example.yaml
docker compose up -d
docker compose logs myservices        # clé publique de l'app et commande pour l'autoriser sur l'hôte
```

Puis ouvrez `http://<IP>:8090/myservices/v2/` **dans les 30 minutes** pour créer le compte admin (passé ce délai :
`docker compose restart myservices`), et suivez la carte « Premiers pas ». Image : `ghcr.io/erreur32/myservices` (amd64 et arm64) ;
`:latest` suit le dernier tag, `:0.9.5` une version précise, `:docker` le dernier état de la branche.

Mise à jour : `docker compose pull && docker compose up -d` (réglages et données sont dans les volumes `./config` et `./data`).

## Développer

```bash
docker build -t myservices:dev .
docker run --rm --entrypoint python -v $PWD:/src:ro -w /src myservices:dev -m unittest discover -s tests
cd front && npm ci && npm test && npm run dev      # :5180
```

Versions : `python3 scripts/release.py` vérifie que la version, les deux README, le changelog et les notes de version sont d'accord ;
`release.py patch|minor|X.Y.Z` applique une nouvelle version partout (il ne committe, ne tague et ne pousse rien).

Garde-fou avant commit et push : `bash scripts/install-hooks.sh` (refuse jetons, mots de passe, clés, `config.json`, `.env`, bases,
images non relues). `.claude/` n'est jamais versionné. Écrire un connecteur : [docs/CONNECTEURS.md](docs/CONNECTEURS.md).

> La documentation complète (installation détaillée, machines, connecteurs, API et MCP, sécurité) sera écrite quand la version sera
> stable ; l'ancienne documentation de l'installation classique n'était plus à jour et a été retirée.
