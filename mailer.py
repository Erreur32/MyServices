"""Sending e-mails (forgotten password, test): SMTP settings of config.json (Settings → System → E-mail).

  smtp_host, smtp_port (587), smtp_security (starttls | ssl | none), smtp_user, smtp_password (encrypted at rest),
  smtp_from (sender), page_url (address of the page, put in the links: never taken from the request, a forged Host header
  would send the link elsewhere).
Standard library only (smtplib); the certificate is always checked.
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

SECURITY = ("starttls", "ssl", "none")
KEYS = ("smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_password", "smtp_from", "page_url")


class MailError(Exception):
    pass


def ready(cfg: dict) -> bool:
    """Enough to send: a server, a sender and the address of the page."""
    return bool(cfg.get("smtp_host") and cfg.get("smtp_from") and cfg.get("page_url"))


def send(cfg: dict, to: str, subject: str, text: str) -> None:
    if not ready(cfg):
        raise MailError("envoi d'e-mails non réglé (Réglages → Système → E-mail)")
    msg = EmailMessage()
    msg["From"] = formataddr(("MyServices", cfg["smtp_from"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=str(cfg["smtp_from"]).rpartition("@")[2] or None)
    msg.set_content(text)
    sec = cfg.get("smtp_security") or "starttls"
    port = int(cfg.get("smtp_port") or (465 if sec == "ssl" else 587))
    tls = ssl.create_default_context()
    try:
        if sec == "ssl":
            server = smtplib.SMTP_SSL(cfg["smtp_host"], port, timeout=20, context=tls)
        else:
            server = smtplib.SMTP(cfg["smtp_host"], port, timeout=20)
        with server:
            if sec == "starttls":
                server.starttls(context=tls)
            if cfg.get("smtp_user"):
                server.login(cfg["smtp_user"], cfg.get("smtp_password") or "")
            server.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise MailError("compte ou mot de passe du serveur d'envoi refusé") from None
    except (smtplib.SMTPException, OSError) as e:
        raise MailError(f"envoi impossible ({type(e).__name__}: {str(e)[:160]})") from None


def reset_text(page_url: str, token: str, username: str, minutes: int) -> tuple[str, str]:
    link = f"{page_url.rstrip('/')}/login.html?reset={token}"
    return ("MyServices : réinitialiser votre mot de passe",
            f"Bonjour,\n\nUne demande de nouveau mot de passe a été faite pour le compte « {username} ».\n\n"
            f"Pour choisir un nouveau mot de passe, ouvrez ce lien (valable {minutes} minutes, une seule fois) :\n{link}\n\n"
            "Vous n'avez rien demandé ? Ignorez ce message : votre mot de passe actuel reste valable.\n\n-- MyServices\n")
