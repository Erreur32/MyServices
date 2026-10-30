# Écrire un connecteur

Un connecteur relie MyServices à un service que l'on a déjà (NPM, AdGuard, Beszel, Uptime Kuma…), en
**lecture seule**, par son API ou par SSH. Le code vit dans `connectors/`, un fichier par service.

## Le contrat (`connectors/base.py`)

```python
from connectors.base import Connector, ConnectorError, Field, Result

class UptimeKuma(Connector):
    type = "uptime-kuma"                 # identifiant stable ; une instance = type + nom unique
    label = "Uptime Kuma"                # nom affiché
    kinds = ("services",)                # inventory, services, health, backups, logs, alerts
    images = ("louislam/uptime-kuma",)   # images Docker qui le révèlent (détection par setup.py --add)
    tested = ("1.23", "2.0")             # versions vérifiées ; une autre = « version non testée »
    fields = (                           # réglages : formulaire de la page Réglages
        Field("url", "URL", "url", required=True),
        Field("token", "Clé d'API", "password", required=True, secret=True),
    )
    setup_fields = ("url", "token")      # demandés par setup.py à la détection

    def version(self) -> str | None:     # facultatif
        ...

    def collect(self) -> dict:           # données du passage ; ConnectorError si illisible
        data = self.ctx.http(self.conf["url"] + "/metrics", headers={...})
        ...

    @classmethod
    def discover(cls, image, ip, ports):  # facultatif : réglages proposés pour un conteneur reconnu
        port = next((h for h, c in ports if c == 3001), None)
        return {"url": f"http://{ip}:{port}"} if port else None
```

Puis l'ajouter à `TYPES` dans `connectors/__init__.py`.

## Ce que le cœur fournit

- `self.ctx.http(url, method=, body=, headers=, verify_tls=, timeout=)` : JSON décodé, ou
  `ConnectorError` lisible (code HTTP, message de l'API). `verify_tls=False` seulement pour un
  certificat auto-signé, et jamais par défaut.
  `payload=` envoie un corps brut (enveloppe SOAP : `headers` donne son type), `binary=True` rend les octets tels quels.
  `digest=(utilisateur, mot de passe)` répond une seule fois à un défi Digest (box FRITZ!) : un second refus est rendu tel quel.
- `self.ctx.ssh(alias, cmd, stdin=)` : sortie d'une commande par un alias SSH de l'app.
- **Isolation** (`run_isolated`) : délai maximal, erreur ou bug capturés, dernier résultat bon réutilisé
  et marqué « périmé », passages en échec comptés. Un connecteur en panne ne bloque pas les autres.
- **Version** : `version()` comparée à `tested` ; `--check` et `data.json` (« connectors ») signalent une
  version non testée.

## Règles

- **Lecture seule** : uniquement des GET (ou la connexion qui donne un jeton). Jamais d'écriture.
  Exception : un protocole qui lit par POST (SOAP de l'UPnP), avec seulement des actions de lecture listées dans le code.
- **Secrets** : champs `secret=True` ; jamais dans un message d'erreur, un journal ou la page
  (`Connector.public()` les remplace par « configuré »).
- **Messages en français**, qui disent quoi faire (« jeton refusé : regénérer la clé dans … »).
- **Lecture tolérante** : un champ absent donne « non lisible » sur cette donnée, pas une exception.

## Tests

Enregistrer de vraies réponses de l'API, **anonymisées** (noms, IP, jetons), dans
`tests/fixtures/<type>/`, et les rejouer avec un faux serveur (voir `tests/test_connectors.py`, faux NPM).
Une nouvelle version du service : enregistrer ses réponses, relancer les tests, ajouter la version à `tested`.

```bash
python3 -m unittest discover -s tests
```

## Formes de données communes

Ce qu'un connecteur (ou la santé, la veille, les sauvegardes) produit se plie à `models.py` : `Machine`, `Service`, `Health`,
`Backup`, `Event`, `Alert` (pydantic). Un champ en plus est gardé ; un champ de base manquant ou mal typé est refusé par
`models.validate()`, utilisé par les tests. Le front lit les mêmes formes (`front/src/types.ts`).

## Box internet

Un connecteur de box remplit `Box` (`connectors/box_kit.py`) avec ce que son protocole donne et rend `box_card(box)` : les champs restés à `None` ne s'affichent pas.
L'adresse publique passe par `public_address()`, qui écarte `0.0.0.0` et les adresses privées, et reste hors des `facts` (le bouton Tester les affiche).

## Cache

`self.ctx.cached(clé, durée_en_secondes, fonction)` garde le résultat JSON de `fonction()` pour la durée donnée (dossier de
cache du collecteur) : un service lent ou limité n'est pas interrogé à chaque passage. Une erreur de `fonction()` n'écrase jamais
la valeur gardée. Les secrets des réglages arrivent déjà déchiffrés : un connecteur ne touche jamais au chiffrement.

## Version non testée

Quand le service passe dans une version absente de `tested`, la veille envoie une alerte « 🔌 Version non testée » une seule
fois (le connecteur continue de marcher : l'API a pu changer, à surveiller).
