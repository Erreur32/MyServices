# Release notes: MyServices 0.38.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.3** (6 November 2026) ends the false alerts of Windows PCs, and makes the Home alerts say where a service points and why it fails.

## For everyone

**Fixed**
- **Windows PCs: no more services coming and going**: on some PCs, Windows hands back only a small, different part of its listening ports at each read (5 ports out of about 30, for PowerShell, `netstat` and .NET alike). The server no longer takes a port missing from one report for closed: it keeps it while it still answers. The Windows agent v11 also reads the list several times and keeps every port it saw, so the list is nearly complete at each report. Checked on a real PC: no false alert in 3 hours, 18 to 21 ports per report instead of 5.
- **Home alerts in plain words**: a service down names where it points and why (« NPM l'envoie vers 10.0.0.5:8080, connexion refusée ») instead of « backend down » and a Python error name. The same words show after « Tester », on the service page and when adding a service by hand.
- **NPM redirect without DNS**: shown « DNS absent » in orange, like a proxy host, with a hint to create the name or remove the entry, instead of a red error.
- **One line for a backup machine's disk** when Health already reads that machine.
- **Wording**: plurals agree on the Home page, « 2 h » instead of « 2 h 0 min », and a clearer Web-Check line.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). A Windows agent with automatic update takes v11 at its next report; otherwise click « Mettre à jour » on its row in Machines › Agents. No new key needed. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: Windows agent v11 (`health.WIN_PS`, served inside `agent.ps1`, also used over SSH): `Get-NetTCPConnection -State Listen` is read every 0.5 s until 6 reads in a row bring no new port (20 reads at most), and the ports of all reads are kept. About 4 s more per report on a healthy PC. Linux agent unchanged (v11).
- **Server**: the port pulse only trusts a port the report shows; the collection keeps a port an agent showed before while its TCP probe answers. Error names are translated in the front (`errText`).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
