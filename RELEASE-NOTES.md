# Release notes: MyServices 0.15.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.1** (18 October 2026): the home page's attention card is sorted by category and severity, and the Fail2ban statistics and attacked domains now work with LogviewR.

## For everyone

**What's new?**
- **Home page, attention card**: the points that need a look are now sorted into categories (machines, services, health, DNS, backups, connectors). The categories with red points come first, and inside each one the red lines come before the orange ones. Each category shows its red and orange counts, and a click on its header folds it (the choice is kept in your browser).
- **Fail2ban statistics and attacked domains fixed**: with LogviewR the statistics were empty (the history request was too large) and no domain was found (the search was filled by Fail2ban's own log). Both work now: bans per hour and per day, per jail, and the domains the banned addresses went after.
- **Security page, access to MyServices**: who can get into MyServices itself (accounts, API and MCP tokens, agents), with when each was last used and a flag for what is no longer used. The most banned addresses show their country and owner.
- **AI model to service**: the AI model a machine runs (read by GpuViewR) links to its service. vLLM, LocalAI and KoboldCpp are recognised too.
- **Two new alerts**: a container image with a newer version, and a Fail2ban jail that suddenly goes up (at least 20 bans in 24 hours and three times its usual level). Both show in the history and can be sent by the alert channels.
- **Smaller things**: no stray focus ring after a click, the Fail2ban card and the certificates fold, a new SSH key gets a comment of its own, the start guide lists the scheduled tasks, and the backup scan reads more cron and timer sources.
- **Fewer duplicate requests**: panels of one screen that load the same data now share a single request.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.1` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Fixed**: `connectors/logviewr.py` (`HISTORY_LIMIT` 1000, `WEB_LOGS` for `log_search`); `api.ts` `read()` shares identical requests in flight.
- **Changed**: `lib/summary.ts` (`Attention.category`, `groupAttention`, `limitGroups`) and the new `components/AttentionGroups.tsx`; no server change.
