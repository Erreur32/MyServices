# Notes de version : MyServices 0.11.1

> **Version en ligne, à un stade précoce.** MyServices est utilisable, mais jeune : des écrans et des réglages peuvent encore changer. Gardez une copie de `config/` et `data/` avant de mettre à jour, et laissez-le sur votre réseau local.


**0.11.1** (13 octobre 2026) : corrections des connecteurs (jeton, versions affichées, formulaire).

## Pour tout le monde

**Quoi de neuf ?**
- **Corrigé : l'ancien jeton revenait.** En modifiant un connecteur, le navigateur (ou le gestionnaire de mots de passe) remplissait le champ du jeton avec une valeur mémorisée, souvent l'ancienne. Les champs secrets refusent maintenant ce remplissage.
- **Version de l'application sur chaque carte de connecteur**, quand le service la donne. La plupart des connecteurs la trouvaient sans l'afficher.
- **LogviewR** n'affiche plus « v1.0.0 » : c'était la version de son serveur MCP, pas celle de l'appli. La vraie version s'affichera avec une prochaine version de LogviewR.
- **Onduleur (NUT)** : le modèle n'est plus montré comme une version, il a sa propre ligne « Modèle ».
- **Modifier un connecteur** se fait dans sa carte, sans second cadre bleu ni logo et titre en double.

**Mettre à jour** : `docker compose pull`, puis `docker compose up -d` (avec l'image `:latest`). Rien à changer dans le compose.

## En résumé, côté technique

- **Image** : `ghcr.io/erreur32/myservices:0.11.1` (amd64 et arm64) ; `:latest` suit le dernier tag, `:main` le dernier commit.
- **Modifié** : `front/src/components/SecretInput.tsx` (`autocomplete="new-password"`, attributs d'exclusion des gestionnaires de mots de passe), `front/src/tabs/Connectors.tsx`, `connectors/base.py` (version trouvée pendant la collecte reprise sur la carte), `connectors/logviewr.py`, `connectors/homelab_infra.py` (NUT).
