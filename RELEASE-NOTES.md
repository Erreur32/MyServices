# Release notes: MyServices 0.15.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.4** (18 October 2026): a safer import, settings read again after an import, a clearer SSH message and aligned machine cards.

## For everyone

**What's new?**
- **Import no longer replaces this installation's own SSH key**: when the key in the archive differs from the one in use, it is kept (the machines that authorized it would refuse the new one). A tick box lets you replace it anyway. The page also warns when the SSH aliases and the machine list are not imported together, and says which files were kept.
- **After an import**: the settings are read again without restarting the container (the imported schedules apply at once), and the collection, the watch and the health run one after the other.
- **SSH “key refused”**: the message now names the account and the key file the machine's alias really uses, and shows the public key to authorize.
- **Machine cards in Settings, Machines**: one fixed height; at most three roles on one line, the others behind a “+N” with their names in the tooltip.
- **E-mail**: the Profile page warns when sending is not set up, when the latest sending failed, or when there is no address; a full SMTP setup shows examples (OVH, Gmail, Brevo, Mailgun).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.4` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `config_transfer.apply(..., replace_app_keys)` and `protected()`; `system.reload_config` and `system.after_import`; `setup.refused_key_text`; `RoleBadges`.
