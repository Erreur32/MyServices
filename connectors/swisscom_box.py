"""Swisscom Internet-Box (2, 3, Plus, Standard, Light): the same « sysbus » API as the Livebox (POST /ws, createContext login, NMC and DeviceInfo getters), checked against the
python-swisscom-internet-box client (same content type, same calls). Nothing is duplicated: the reading is Livebox's, only the type, the fields and the wording differ.
The Swisscom client needs a cookie only for write requests; reads work with the context headers alone. Not tested on a real box.
"""
from __future__ import annotations

from connectors.base import ConnectorError, Field
from connectors.livebox import Livebox


class SwisscomBox(Livebox):
    type = "swisscom-box"
    label = "Swisscom Internet-Box"
    fields = (
        Field("url", "Adresse de l'Internet-Box", "url", default="http://192.168.1.1", help="L'adresse de son interface web, souvent http://192.168.1.1 (ou http://internetbox.home)."),
        Field("username", "Utilisateur", "text", required=True, default="admin", help="admin sauf si tu l'as changé."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de l'interface de l'Internet-Box (imprimé sous la box au départ)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("MyServices lit l'état de l'Internet-Box par son API locale, avec le compte de son interface web (admin) : il ne fait que lire.",
             "Donne l'adresse de la box (souvent http://192.168.1.1) : celle qui ouvre son interface web depuis le serveur.",
             "Une mauvaise adresse ou un mauvais mot de passe bloquent la box un moment : teste d'abord le compte dans l'interface de la box.",
             "La box ne donne pas ici la température ni les appareils connectés.")

    def collect(self) -> dict:
        try:
            return super().collect()
        except ConnectorError as e:
            raise ConnectorError(str(e).replace("la Livebox", "l'Internet-Box").replace("Livebox", "Internet-Box")) from None
